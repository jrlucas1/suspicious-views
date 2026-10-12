import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, classify } from '../src/classifier.ts';
import { REPORT_SEED, TUNING_SEED, generateDataset } from '../src/dataset.ts';
import {
  THRESHOLD_SWEEP,
  measure,
  renderThresholdCosts,
  thresholdCosts,
} from '../src/evaluation.ts';
import type { ThresholdCost } from '../src/evaluation.ts';
import { ORGANIC_WEEKDAYS, add, alternating, constant } from './helpers.ts';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const tuningDataset = generateDataset(TUNING_SEED);

const detected = (views: number[], thresholds = DEFAULT_THRESHOLDS) =>
  classify(views, thresholds)
    .signals.filter((signal) => signal.detected)
    .map((signal) => signal.name);

describe('limiares do classificador', () => {
  it('os limiares padrão são os da regra publicada', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({
      flatWindowHours: 8,
      flatMinMean: 50,
      flatMaxDispersion: 0.05,
      jumpFactor: 3,
      jumpMinViews: 100,
      boxMinRetention: 0.5,
    });
  });

  it('classificar sem limiares é classificar com os padrão', () => {
    for (const series of tuningDataset.slice(0, 200)) {
      expect(classify(series.views)).toEqual(classify(series.views, DEFAULT_THRESHOLDS));
    }
  });

  it('a janela de flat_run decide se 6 horas iguais bastam', () => {
    const sixFlat = [...alternating(9, 300, 360), ...constant(6, 500), ...alternating(9, 300, 360)];

    expect(detected(sixFlat)).toEqual([]);
    expect(detected(sixFlat, { ...DEFAULT_THRESHOLDS, flatWindowHours: 6 })).toEqual(['flat_run']);
    expect(classify(sixFlat, { ...DEFAULT_THRESHOLDS, flatWindowHours: 6 }).classification).toBe('suspicious');
  });

  it('a dispersão máxima decide quanta variação ainda conta como igual demais', () => {
    // Média 500 e variância amostral perto de 52: cerca de 10% da média.
    const tight = alternating(24, 493, 507);

    expect(detected(tight)).toEqual([]);
    expect(detected(tight, { ...DEFAULT_THRESHOLDS, flatMaxDispersion: 0.2 })).toEqual(['flat_run']);
  });

  it('o fator de salto decide se uma subida de 2,5x é brusca', () => {
    const rise = [...alternating(12, 180, 220), ...alternating(12, 480, 560)];

    expect(detected(rise)).toEqual([]);
    expect(detected(rise, { ...DEFAULT_THRESHOLDS, jumpFactor: 2 })).toEqual(['sudden_rise']);
  });

  it('a retenção mínima decide se um pico que já perdeu força ainda é caixa', () => {
    const plateau = [5000, 4600, 4200, 3800, 3400, 3000, 2600, 2200, 1800];
    const fading = add(ORGANIC_WEEKDAYS, 30, plateau);

    expect(classify(fading).classification).toBe('inconclusive');
    expect(classify(fading, { ...DEFAULT_THRESHOLDS, boxMinRetention: 0.25 }).classification).toBe('suspicious');
  });

  it('a descrição do sinal ausente usa o limiar em vigor', () => {
    const quiet = constant(24, 3);
    const signals = classify(quiet, { ...DEFAULT_THRESHOLDS, flatWindowHours: 6, jumpFactor: 4 }).signals;

    expect(signals.map((signal) => signal.description)).toEqual([
      'Nenhuma sequência de 6 horas com números iguais demais.',
      'Nenhuma hora em que as views subiram 4x ou mais e ficaram no alto.',
      'Nenhuma hora em que as views caíram 4x ou mais e ficaram embaixo.',
    ]);
  });
});

describe('custo por limiar', () => {
  const costs = thresholdCosts(tuningDataset);
  const rowsOf = (threshold: string) => costs.filter((cost) => cost.threshold === threshold);

  it('cada limiar varrido tem exatamente uma linha com o valor usado, e ela bate com a regra', () => {
    const used = measure(tuningDataset);

    for (const { name, values } of THRESHOLD_SWEEP) {
      const rows = rowsOf(name);
      expect(rows.map((row) => row.value), name).toEqual(values);
      expect(rows.filter((row) => row.used).map((row) => row.value), name).toEqual([DEFAULT_THRESHOLDS[name]]);
      expect(rows.find((row) => row.used), name).toMatchObject({
        falsePositives: used.falsePositives,
        legitimateTotal: used.legitimateTotal,
        falseNegatives: used.suspiciousTotal - used.detected,
        suspiciousTotal: used.suspiciousTotal,
      });
    }
  });

  it('falso negativo é série suspeita que não foi classificada como suspeita', () => {
    const flat = constant(24, 500);
    const quiet = constant(24, 3);
    const [first] = thresholdCosts([
      { id: 'a', label: 'legitimate', scenario: 'honest', views: flat },
      { id: 'b', label: 'legitimate', scenario: 'honest', views: quiet },
      { id: 'c', label: 'suspicious', scenario: 'bots', views: flat },
      { id: 'd', label: 'suspicious', scenario: 'bots', views: quiet },
      { id: 'e', label: 'suspicious', scenario: 'bots', views: quiet },
    ]);

    expect(first).toMatchObject({ falsePositives: 1, legitimateTotal: 2, falseNegatives: 2, suspiciousTotal: 3 });
  });

  it('afrouxar um limiar nunca diminui os falsos positivos nem aumenta os falsos negativos', () => {
    // Em cada lista os valores vão do mais exigente ao mais frouxo.
    const looserLast: Record<string, number[]> = {
      flatWindowHours: [12, 8, 6],
      flatMaxDispersion: [0.02, 0.05, 0.1, 0.2],
      jumpFactor: [5, 4, 3, 2],
      boxMinRetention: [0.75, 0.5, 0.25],
    };

    for (const [name, order] of Object.entries(looserLast)) {
      const rows = order.map((value) => rowsOf(name).find((row) => row.value === value));
      expect(rows.every((row) => row !== undefined), name).toBe(true);
      for (let index = 1; index < rows.length; index++) {
        expect(rows[index]!.falsePositives, `${name} ${order[index]}`).toBeGreaterThanOrEqual(rows[index - 1]!.falsePositives);
        expect(rows[index]!.falseNegatives, `${name} ${order[index]}`).toBeLessThanOrEqual(rows[index - 1]!.falseNegatives);
      }
    }
  });

  it('a tabela marca o valor usado e mostra falsos positivos e falsos negativos de cada linha', () => {
    const sample: ThresholdCost[] = [
      { threshold: 'jumpFactor', value: 2, used: false, falsePositives: 30, legitimateTotal: 600, falseNegatives: 50, suspiciousTotal: 400 },
      { threshold: 'jumpFactor', value: 3, used: true, falsePositives: 9, legitimateTotal: 600, falseNegatives: 60, suspiciousTotal: 400 },
      { threshold: 'flatMaxDispersion', value: 0.05, used: true, falsePositives: 9, legitimateTotal: 600, falseNegatives: 60, suspiciousTotal: 400 },
    ];

    const table = renderThresholdCosts(9, sample);

    expect(table).toContain('### Custo por limiar');
    expect(table).toContain('seed 9');
    expect(table).toContain('| Limiar | Valor | Falsos positivos | Falsos negativos |');
    expect(table).toContain('| Fator de subida e de queda | 2x | 30 de 600 (5,00%) | 50 de 400 (12,50%) |');
    expect(table).toContain('| Fator de subida e de queda | **3x (usado)** | 9 de 600 (1,50%) | 60 de 400 (15,00%) |');
    expect(table).toContain('| Variância máxima de `flat_run` | **5% da média (usado)** | 9 de 600 (1,50%) | 60 de 400 (15,00%) |');
    expect(table.endsWith('\n')).toBe(true);
  });

  it('o README traz a tabela medida agora na seed de ajuste', () => {
    expect(readme).toContain(renderThresholdCosts(TUNING_SEED, costs));
  });

  it('a tabela não é medida na seed publicada', () => {
    expect(TUNING_SEED).not.toBe(REPORT_SEED);
    expect(renderThresholdCosts(TUNING_SEED, costs)).toContain(`seed ${TUNING_SEED}`);
    expect(renderThresholdCosts(TUNING_SEED, costs)).not.toContain(`seed ${REPORT_SEED}`);
  });
});

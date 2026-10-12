import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOURS, generateDataset, parseDataset, serializeDataset } from '../src/dataset.ts';
import {
  evaluate,
  measure,
  renderEvaluation,
  renderReport,
  replaceReport,
  wilsonInterval,
} from '../src/evaluation.ts';
import type { Measurement } from '../src/evaluation.ts';
import { alternating, constant } from './helpers.ts';

function readText(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
}

const committedDataset = readText('../data/dataset.jsonl');
const readme = readText('../README.md');

describe('dataset sintético', () => {
  it('o arquivo commitado é o que o gerador produz', () => {
    expect(committedDataset).toBe(serializeDataset(generateDataset()));
  });

  it('a mesma seed gera o mesmo dataset e outra seed gera outro', () => {
    expect(generateDataset(7)).toEqual(generateDataset(7));
    expect(generateDataset(7)).not.toEqual(generateDataset(8));
  });

  it('tem 600 séries legítimas e 400 suspeitas, de 168 horas, com inteiros não negativos', () => {
    const dataset = parseDataset(committedDataset);
    const count = (label: string) => dataset.filter((series) => series.label === label).length;

    expect(count('legitimate')).toBe(600);
    expect(count('suspicious')).toBe(400);
    expect(new Set(dataset.map((series) => series.id)).size).toBe(1000);
    for (const series of dataset) {
      expect(series.views).toHaveLength(HOURS);
      expect(series.views.every((views) => Number.isInteger(views) && views >= 0)).toBe(true);
    }
  });
});

describe('taxa de falso positivo', () => {
  it('o README traz exatamente o que foi medido no dataset', () => {
    const measured = renderReport(measure(parseDataset(committedDataset)));

    expect(readme).toContain(measured);
  });

  it('falso positivo é série legítima classificada como suspeita', () => {
    const flat = constant(24, 500);
    const quiet = constant(24, 3);
    const gone = [...alternating(12, 400, 430), ...constant(12, 0)];

    const measurement = measure([
      { id: 'a', label: 'legitimate', scenario: 'honest', views: flat },
      { id: 'b', label: 'legitimate', scenario: 'honest', views: quiet },
      { id: 'c', label: 'legitimate', scenario: 'honest', views: gone },
      { id: 'd', label: 'legitimate', scenario: 'honest', views: quiet },
      { id: 'e', label: 'suspicious', scenario: 'bots', views: flat },
      { id: 'f', label: 'suspicious', scenario: 'bots', views: quiet },
    ]);

    expect(measurement).toEqual<Measurement>({
      scenarios: [
        { label: 'legitimate', scenario: 'honest', total: 4, legitimate: 2, inconclusive: 1, suspicious: 1 },
        { label: 'suspicious', scenario: 'bots', total: 2, legitimate: 1, inconclusive: 0, suspicious: 1 },
      ],
      legitimateTotal: 4,
      falsePositives: 1,
      legitimateInconclusive: 1,
      suspiciousTotal: 2,
      detected: 1,
    });
    expect(renderReport(measurement)).toContain(
      '- Taxa de falso positivo: **25,00%** (1 de 4 séries legítimas classificadas como `suspicious`).',
    );
  });

  it('o comando troca só a seção medida do README', () => {
    const before = '# Título\n\n## Resultado medido\n\nvelho\n\n## Limites\n\ntexto\n';

    expect(replaceReport(before, '## Resultado medido\n\nnovo\n')).toBe(
      '# Título\n\n## Resultado medido\n\nnovo\n\n## Limites\n\ntexto\n',
    );
    expect(() => replaceReport('# Título\n', 'novo')).toThrow(
      'O README não tem a seção "## Resultado medido".',
    );
  });
});

describe('avaliação em outras seeds', () => {
  const measurement = (falsePositives: number, detected: number): Measurement => ({
    scenarios: [
      {
        label: 'legitimate',
        scenario: 'honest',
        total: 200,
        legitimate: 200 - falsePositives - 30,
        inconclusive: 30,
        suspicious: falsePositives,
      },
      {
        label: 'suspicious',
        scenario: 'bots',
        total: 100,
        legitimate: 100 - detected - 5,
        inconclusive: 5,
        suspicious: detected,
      },
    ],
    legitimateTotal: 200,
    falsePositives,
    legitimateInconclusive: 30,
    suspiciousTotal: 100,
    detected,
  });

  it('o README traz a seed de ajuste, a faixa entre seeds e o custo da regra medidos agora', () => {
    const measured = renderEvaluation(evaluate(parseDataset(committedDataset)));

    expect(readme).toContain(measured);
  });

  it('o intervalo de 95% é o de Wilson', () => {
    const nineOfSixHundred = wilsonInterval(9, 600);
    const noneOfSixHundred = wilsonInterval(0, 600);

    expect(nineOfSixHundred.low).toBeCloseTo(0.00791, 5);
    expect(nineOfSixHundred.high).toBeCloseTo(0.02826, 5);
    expect(noneOfSixHundred.low).toBeCloseTo(0, 10);
    expect(noneOfSixHundred.high).toBeCloseTo(0.00636, 5);
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
    expect(renderReport(measurement(4, 80))).toContain(
      '- Intervalo de 95% da taxa (Wilson): 0,78% a 5,03%.',
    );
  });

  it('o relatório separa a seed publicada, a de ajuste e a faixa das seeds de comparação', () => {
    const report = renderEvaluation({
      reportSeed: 5,
      report: measurement(4, 80),
      tuningSeed: 9,
      tuning: measurement(2, 90),
      comparisonSeeds: [11, 12, 13],
      comparison: [measurement(6, 70), measurement(1, 85), measurement(3, 60)],
    });

    expect(report).toContain(
      '- Os números acima são da seed 5, gerada depois que os limiares estavam fixos.',
    );
    expect(report).toContain(
      '- Na seed 9, usada para ajustar os limiares: falso positivo de 1,00% (2 de 200) e ' +
        'detecção de 90,00% (90 de 100).',
    );
    expect(report).toContain(
      '- Nas 3 seeds de 11 a 13: falso positivo de 0,50% a 3,00% e detecção de 60,00% a 85,00%.',
    );
    expect(report).toContain('| Qualquer sinal acusa | 34 de 200 | 85 de 100 |');
    expect(report).toContain(
      '| Números iguais demais ou pico em caixa (regra usada) | 4 de 200 | 80 de 100 |',
    );
  });

  it('a seed publicada não é a seed de ajuste nem uma das seeds de comparação', () => {
    const evaluation = evaluate(parseDataset(committedDataset));

    expect(evaluation.reportSeed).toBe(314159);
    expect(evaluation.tuningSeed).toBe(20261011);
    expect(evaluation.comparisonSeeds).toHaveLength(20);
    expect(evaluation.comparisonSeeds).not.toContain(evaluation.reportSeed);
    expect(evaluation.comparisonSeeds).not.toContain(evaluation.tuningSeed);
    expect(evaluation.report).toEqual(measure(generateDataset(314159)));
    expect(evaluation.tuning).toEqual(measure(generateDataset(20261011)));
    expect(evaluation.comparison[0]).toEqual(measure(generateDataset(101)));
  });
});

describe('origem dos falsos positivos', () => {
  it('no dataset commitado, só o cenário scheduled_event tem série legítima acusada', () => {
    const accused = measure(parseDataset(committedDataset))
      .scenarios.filter((result) => result.label === 'legitimate' && result.suspicious > 0)
      .map((result) => result.scenario);

    expect(accused).toEqual(['scheduled_event']);
  });
});

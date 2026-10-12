import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOURS, generateDataset, parseDataset, serializeDataset } from '../src/dataset.ts';
import { measure, renderReport, replaceReport } from '../src/evaluation.ts';
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

import { classify } from './classifier.ts';
import type { Classification } from './classifier.ts';
import { COMPARISON_SEEDS, REPORT_SEED, TUNING_SEED, generateDataset } from './dataset.ts';
import type { Label, LabeledSeries } from './dataset.ts';

export const REPORT_HEADING = '## Resultado medido';

export interface ScenarioResult extends Record<Classification, number> {
  label: Label;
  scenario: string;
  total: number;
}

export interface Measurement {
  scenarios: ScenarioResult[];
  legitimateTotal: number;
  falsePositives: number;
  legitimateInconclusive: number;
  suspiciousTotal: number;
  detected: number;
}

export interface Evaluation {
  reportSeed: number;
  report: Measurement;
  tuningSeed: number;
  tuning: Measurement;
  comparisonSeeds: number[];
  comparison: Measurement[];
}

const WILSON_Z = 1.959964;

const percent = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function measure(dataset: LabeledSeries[]): Measurement {
  const byScenario = new Map<string, ScenarioResult>();
  for (const series of dataset) {
    const result = byScenario.get(series.scenario) ?? {
      label: series.label,
      scenario: series.scenario,
      total: 0,
      legitimate: 0,
      inconclusive: 0,
      suspicious: 0,
    };
    result.total++;
    result[classify(series.views).classification]++;
    byScenario.set(series.scenario, result);
  }

  const scenarios = [...byScenario.values()];
  const sum = (label: Label, field: 'total' | Classification): number =>
    scenarios
      .filter((result) => result.label === label)
      .reduce((total, result) => total + result[field], 0);

  return {
    scenarios,
    legitimateTotal: sum('legitimate', 'total'),
    falsePositives: sum('legitimate', 'suspicious'),
    legitimateInconclusive: sum('legitimate', 'inconclusive'),
    suspiciousTotal: sum('suspicious', 'total'),
    detected: sum('suspicious', 'suspicious'),
  };
}

export function evaluate(dataset: LabeledSeries[]): Evaluation {
  return {
    reportSeed: REPORT_SEED,
    report: measure(dataset),
    tuningSeed: TUNING_SEED,
    tuning: measure(generateDataset(TUNING_SEED)),
    comparisonSeeds: COMPARISON_SEEDS,
    comparison: COMPARISON_SEEDS.map((seed) => measure(generateDataset(seed))),
  };
}

export function wilsonInterval(part: number, total: number): { low: number; high: number } {
  if (total === 0) return { low: 0, high: 1 };
  const proportion = part / total;
  const squared = WILSON_Z ** 2;
  const center = proportion + squared / (2 * total);
  const margin =
    WILSON_Z * Math.sqrt((proportion * (1 - proportion)) / total + squared / (4 * total ** 2));
  const denominator = 1 + squared / total;
  return {
    low: Math.max(0, (center - margin) / denominator),
    high: Math.min(1, (center + margin) / denominator),
  };
}

function rate(part: number, total: number): string {
  return percent.format(total === 0 ? 0 : part / total);
}

function rateRange(measurements: Measurement[], part: 'falsePositives' | 'detected'): string {
  const total = part === 'falsePositives' ? 'legitimateTotal' : 'suspiciousTotal';
  const rates = measurements.map((measurement) => measurement[part] / measurement[total]);
  return `${percent.format(Math.min(...rates))} a ${percent.format(Math.max(...rates))}`;
}

function withAnySignal(measurement: Measurement, label: Label): number {
  return measurement.scenarios
    .filter((result) => result.label === label)
    .reduce((total, result) => total + result.inconclusive + result.suspicious, 0);
}

export function renderReport(measurement: Measurement): string {
  const { legitimateTotal, falsePositives, legitimateInconclusive, suspiciousTotal, detected } =
    measurement;
  const interval = wilsonInterval(falsePositives, legitimateTotal);
  const rows = measurement.scenarios.map(
    (result) =>
      `| ${result.label} | \`${result.scenario}\` | ${result.total} | ${result.legitimate} | ` +
      `${result.inconclusive} | ${result.suspicious} |`,
  );
  return [
    REPORT_HEADING,
    '',
    'Esta seção é escrita por `npm run dataset`. Não edite à mão.',
    '',
    `- Taxa de falso positivo: **${rate(falsePositives, legitimateTotal)}** ` +
      `(${falsePositives} de ${legitimateTotal} séries legítimas classificadas como \`suspicious\`).`,
    `- Intervalo de 95% da taxa (Wilson): ${percent.format(interval.low)} a ` +
      `${percent.format(interval.high)}.`,
    `- Séries legítimas sem acusação e sem absolvição (\`inconclusive\`): ` +
      `${rate(legitimateInconclusive, legitimateTotal)} (${legitimateInconclusive} de ${legitimateTotal}).`,
    `- Séries suspeitas detectadas: ${rate(detected, suspiciousTotal)} ` +
      `(${detected} de ${suspiciousTotal}).`,
    '',
    '| Rótulo | Cenário | Séries | `legitimate` | `inconclusive` | `suspicious` |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
  ].join('\n');
}

export function renderEvaluation(evaluation: Evaluation): string {
  const { report, tuning, comparison, comparisonSeeds } = evaluation;
  const firstSeed = Math.min(...comparisonSeeds);
  const lastSeed = Math.max(...comparisonSeeds);
  return [
    renderReport(report),
    '### Seeds',
    '',
    `- Os números acima são da seed ${evaluation.reportSeed}, gerada depois que os limiares ` +
      `estavam fixos.`,
    `- Na seed ${evaluation.tuningSeed}, usada para ajustar os limiares: falso positivo de ` +
      `${rate(tuning.falsePositives, tuning.legitimateTotal)} ` +
      `(${tuning.falsePositives} de ${tuning.legitimateTotal}) e detecção de ` +
      `${rate(tuning.detected, tuning.suspiciousTotal)} ` +
      `(${tuning.detected} de ${tuning.suspiciousTotal}).`,
    `- Nas ${comparison.length} seeds de ${firstSeed} a ${lastSeed}: falso positivo de ` +
      `${rateRange(comparison, 'falsePositives')} e detecção de ` +
      `${rateRange(comparison, 'detected')}.`,
    '',
    '### Custo de acusar por qualquer sinal',
    '',
    '| Regra | Legítimas acusadas | Suspeitas detectadas |',
    '| --- | ---: | ---: |',
    `| Qualquer sinal acusa | ${withAnySignal(report, 'legitimate')} de ${report.legitimateTotal} | ` +
      `${withAnySignal(report, 'suspicious')} de ${report.suspiciousTotal} |`,
    `| Números iguais demais ou pico em caixa (regra usada) | ${report.falsePositives} de ` +
      `${report.legitimateTotal} | ${report.detected} de ${report.suspiciousTotal} |`,
    '',
  ].join('\n');
}

export function replaceReport(readme: string, report: string): string {
  const start = readme.indexOf(REPORT_HEADING);
  if (start === -1) {
    throw new Error(`O README não tem a seção "${REPORT_HEADING}".`);
  }
  const nextHeading = readme.indexOf('\n## ', start + REPORT_HEADING.length);
  const rest = nextHeading === -1 ? '' : readme.slice(nextHeading);
  return readme.slice(0, start) + report + rest;
}

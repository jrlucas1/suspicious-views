import { DEFAULT_THRESHOLDS, classify } from './classifier.ts';
import type { Classification, Thresholds } from './classifier.ts';
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

export function measure(
  dataset: LabeledSeries[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Measurement {
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
    result[classify(series.views, thresholds).classification]++;
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

export interface ThresholdCost {
  threshold: keyof Thresholds;
  value: number;
  used: boolean;
  falsePositives: number;
  legitimateTotal: number;
  falseNegatives: number;
  suspiciousTotal: number;
}

const wholePercent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });

export const THRESHOLD_SWEEP: {
  name: keyof Thresholds;
  label: string;
  values: number[];
  format: (value: number) => string;
}[] = [
  {
    name: 'flatWindowHours',
    label: 'Horas seguidas de `flat_run`',
    values: [6, 8, 12],
    format: (value) => `${value} horas`,
  },
  {
    name: 'flatMaxDispersion',
    label: 'Variância máxima de `flat_run`',
    values: [0.02, 0.05, 0.1, 0.2],
    format: (value) => `${wholePercent.format(value)} da média`,
  },
  {
    name: 'jumpFactor',
    label: 'Fator de subida e de queda',
    values: [2, 3, 4, 5],
    format: (value) => `${value}x`,
  },
  {
    name: 'boxMinRetention',
    label: 'Patamar mínimo antes da queda',
    values: [0.25, 0.5, 0.75],
    format: (value) => `${wholePercent.format(value)} da subida`,
  },
];

export function thresholdCosts(dataset: LabeledSeries[]): ThresholdCost[] {
  return THRESHOLD_SWEEP.flatMap(({ name, values }) =>
    values.map((value) => {
      const measurement = measure(dataset, { ...DEFAULT_THRESHOLDS, [name]: value });
      return {
        threshold: name,
        value,
        used: value === DEFAULT_THRESHOLDS[name],
        falsePositives: measurement.falsePositives,
        legitimateTotal: measurement.legitimateTotal,
        falseNegatives: measurement.suspiciousTotal - measurement.detected,
        suspiciousTotal: measurement.suspiciousTotal,
      };
    }),
  );
}

export function renderThresholdCosts(seed: number, costs: ThresholdCost[]): string {
  const rows = costs.map((cost) => {
    const sweep = THRESHOLD_SWEEP.find(({ name }) => name === cost.threshold);
    const value = sweep ? sweep.format(cost.value) : String(cost.value);
    return (
      `| ${sweep?.label ?? cost.threshold} | ${cost.used ? `**${value} (usado)**` : value} | ` +
      `${cost.falsePositives} de ${cost.legitimateTotal} ` +
      `(${rate(cost.falsePositives, cost.legitimateTotal)}) | ` +
      `${cost.falseNegatives} de ${cost.suspiciousTotal} ` +
      `(${rate(cost.falseNegatives, cost.suspiciousTotal)}) |`
    );
  });
  return [
    '### Custo por limiar',
    '',
    `Medido na seed ${seed}, a de ajuste. Cada linha muda um limiar e mantém os outros no valor ` +
      `usado. Falso positivo é série legítima classificada como \`suspicious\`. Falso negativo é ` +
      `série suspeita que não foi classificada como \`suspicious\`.`,
    '',
    '| Limiar | Valor | Falsos positivos | Falsos negativos |',
    '| --- | --- | ---: | ---: |',
    ...rows,
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

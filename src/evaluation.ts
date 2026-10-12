import { classify } from './classifier.ts';
import type { Classification } from './classifier.ts';
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

function rate(part: number, total: number): string {
  return percent.format(total === 0 ? 0 : part / total);
}

export function renderReport(measurement: Measurement): string {
  const { legitimateTotal, falsePositives, legitimateInconclusive, suspiciousTotal, detected } =
    measurement;
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

export function replaceReport(readme: string, report: string): string {
  const start = readme.indexOf(REPORT_HEADING);
  if (start === -1) {
    throw new Error(`O README não tem a seção "${REPORT_HEADING}".`);
  }
  const nextHeading = readme.indexOf('\n## ', start + REPORT_HEADING.length);
  const rest = nextHeading === -1 ? '' : readme.slice(nextHeading);
  return readme.slice(0, start) + report + rest;
}

const DAY = [
  120, 95, 80, 61, 55, 49, 70, 110, 160, 210, 260, 240, 275, 301, 280, 262, 290, 330, 361, 340, 310,
  250, 190, 150,
];

export const ORGANIC_WEEKDAYS = [
  ...DAY,
  ...DAY.map((views) => Math.round(views * 1.1)),
  ...DAY.map((views) => Math.round(views * 0.93)),
];

export const NO_SIGNAL_REASON =
  'Nenhum sinal de views artificiais: não há sequência de horas com números iguais demais, ' +
  'nem subida brusca, nem queda brusca.';

export function add(series: number[], startHour: number, extra: number[]): number[] {
  return series.map((views, hour) => views + (extra[hour - startHour] ?? 0));
}

export function constant(hours: number, views: number): number[] {
  return Array.from({ length: hours }, () => views);
}

export function alternating(hours: number, even: number, odd: number): number[] {
  return Array.from({ length: hours }, (_, hour) => (hour % 2 === 0 ? even : odd));
}

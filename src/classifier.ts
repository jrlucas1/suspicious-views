export const CLASSIFICATIONS = ['legitimate', 'inconclusive', 'suspicious'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const FLAT_WINDOW_HOURS = 8;
export const FLAT_MIN_MEAN = 50;
export const FLAT_MAX_DISPERSION = 0.05;
export const JUMP_FACTOR = 3;
export const JUMP_MIN_VIEWS = 100;
export const BOX_MIN_RETENTION = 0.5;

export interface FlatRun {
  startHour: number;
  endHour: number;
  min: number;
  max: number;
  naturalSpread: number;
}

export interface Jump {
  hour: number;
  before: number;
  after: number;
  factor: number;
}

export type Signal =
  | { name: 'flat_run'; detected: boolean; description: string; evidence: FlatRun | null }
  | {
      name: 'sudden_rise' | 'sudden_drop';
      detected: boolean;
      description: string;
      evidence: Jump | null;
    };

export interface Verdict {
  classification: Classification;
  reason: string;
  signals: Signal[];
}

interface Box {
  rise: Jump;
  drop: Jump;
}

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values: number[]): number {
  const average = mean(values);
  const squares = values.reduce((sum, value) => sum + (value - average) ** 2, 0);
  return squares / (values.length - 1);
}

function isFlat(window: number[]): boolean {
  const average = mean(window);
  return average >= FLAT_MIN_MEAN && sampleVariance(window) <= FLAT_MAX_DISPERSION * average;
}

function findFlatRun(views: number[]): FlatRun | null {
  let longest: { start: number; end: number } | null = null;
  let current: { start: number; end: number } | null = null;

  for (let start = 0; start + FLAT_WINDOW_HOURS <= views.length; start++) {
    const end = start + FLAT_WINDOW_HOURS - 1;
    if (!isFlat(views.slice(start, end + 1))) {
      current = null;
      continue;
    }
    current = current === null ? { start, end } : { start: current.start, end };
    if (longest === null || current.end - current.start > longest.end - longest.start) {
      longest = current;
    }
  }

  if (longest === null) return null;
  const stretch = views.slice(longest.start, longest.end + 1);
  return {
    startHour: longest.start,
    endHour: longest.end,
    min: Math.min(...stretch),
    max: Math.max(...stretch),
    naturalSpread: Math.round(Math.sqrt(mean(stretch))),
  };
}

function findRises(views: number[]): Jump[] {
  const rises: Jump[] = [];
  for (let hour = 2; hour + 1 < views.length; hour++) {
    const before = Math.max(...views.slice(hour - 2, hour));
    const after = Math.min(...views.slice(hour, hour + 2));
    if (after >= JUMP_FACTOR * before && after - before >= JUMP_MIN_VIEWS) {
      rises.push({ hour, before, after, factor: after / Math.max(before, 1) });
    }
  }
  return rises;
}

function findDrops(views: number[]): Jump[] {
  const drops: Jump[] = [];
  for (let hour = 2; hour + 1 < views.length; hour++) {
    const before = Math.min(...views.slice(hour - 2, hour));
    const after = Math.max(...views.slice(hour, hour + 2));
    if (before >= JUMP_FACTOR * after && before - after >= JUMP_MIN_VIEWS) {
      drops.push({ hour, before, after, factor: before / Math.max(after, 1) });
    }
  }
  return drops;
}

function findBox(rises: Jump[], drops: Jump[]): Box | null {
  for (const rise of rises) {
    const drop = drops.find((candidate) => candidate.hour > rise.hour);
    if (drop !== undefined && drop.before >= BOX_MIN_RETENTION * rise.after) {
      return { rise, drop };
    }
  }
  return null;
}

function strongest(jumps: Jump[]): Jump | null {
  return jumps.reduce<Jump | null>(
    (best, jump) => (best === null || jump.factor > best.factor ? jump : best),
    null,
  );
}

function describeFlatRun(run: FlatRun): string {
  return (
    `Das horas ${run.startHour} a ${run.endHour}, as views ficaram entre ` +
    `${integer.format(run.min)} e ${integer.format(run.max)} por hora. ` +
    `Audiência real nesse volume oscila pelo menos ${integer.format(run.naturalSpread)} views ` +
    `de uma hora para outra.`
  );
}

function describeRise(rise: Jump): string {
  return (
    `As views subiram ${decimal.format(rise.factor)}x na hora ${rise.hour} ` +
    `(de ${integer.format(rise.before)} para ${integer.format(rise.after)} por hora).`
  );
}

function describeDrop(drop: Jump): string {
  return (
    `As views caíram ${decimal.format(drop.factor)}x na hora ${drop.hour} ` +
    `(de ${integer.format(drop.before)} para ${integer.format(drop.after)} por hora).`
  );
}

function describeBox({ rise, drop }: Box): string {
  return (
    `${describeRise(rise)} Ficaram ${drop.hour - rise.hour} horas nesse patamar. ` +
    `${describeDrop(drop)} Pico de audiência real perde força aos poucos. ` +
    `Este entrou e saiu de uma vez, como pacote de views comprado.`
  );
}

function decide(
  flatRun: FlatRun | null,
  box: Box | null,
  rise: Jump | null,
  drop: Jump | null,
): Pick<Verdict, 'classification' | 'reason'> {
  if (flatRun !== null || box !== null) {
    const reasons = [
      flatRun && `${describeFlatRun(flatRun)} Números tão iguais indicam entrega automática.`,
      box && describeBox(box),
    ];
    return { classification: 'suspicious', reason: reasons.filter(Boolean).join(' ') };
  }
  if (rise !== null && drop !== null) {
    return {
      classification: 'inconclusive',
      reason:
        `${describeRise(rise)} ${describeDrop(drop)} ` +
        `As duas mudanças não formam um pico que entra e sai de uma vez. ` +
        `Não há evidência suficiente para acusar.`,
    };
  }
  if (rise !== null) {
    return {
      classification: 'inconclusive',
      reason:
        `${describeRise(rise)} Depois disso não houve queda brusca. ` +
        `Subida rápida com queda gradual acontece quando o vídeo é compartilhado por um perfil grande. ` +
        `Não há evidência suficiente para acusar.`,
    };
  }
  if (drop !== null) {
    return {
      classification: 'inconclusive',
      reason:
        `${describeDrop(drop)} Não houve subida brusca antes. ` +
        `Vídeo removido ou falha na coleta dos dados explicam uma queda assim. ` +
        `Não há evidência suficiente para acusar.`,
    };
  }
  return {
    classification: 'legitimate',
    reason:
      'Nenhum sinal de views artificiais: não há sequência de horas com números iguais demais, ' +
      'nem subida brusca, nem queda brusca.',
  };
}

export function classify(views: number[]): Verdict {
  const flatRun = findFlatRun(views);
  const rises = findRises(views);
  const drops = findDrops(views);
  const box = findBox(rises, drops);
  const rise = box?.rise ?? strongest(rises);
  const drop = box?.drop ?? strongest(drops);

  return {
    ...decide(flatRun, box, rise, drop),
    signals: [
      {
        name: 'flat_run',
        detected: flatRun !== null,
        description: flatRun
          ? describeFlatRun(flatRun)
          : `Nenhuma sequência de ${FLAT_WINDOW_HOURS} horas com números iguais demais.`,
        evidence: flatRun,
      },
      {
        name: 'sudden_rise',
        detected: rise !== null,
        description: rise
          ? describeRise(rise)
          : `Nenhuma hora em que as views subiram ${JUMP_FACTOR}x ou mais e ficaram no alto.`,
        evidence: rise,
      },
      {
        name: 'sudden_drop',
        detected: drop !== null,
        description: drop
          ? describeDrop(drop)
          : `Nenhuma hora em que as views caíram ${JUMP_FACTOR}x ou mais e ficaram embaixo.`,
        evidence: drop,
      },
    ],
  };
}

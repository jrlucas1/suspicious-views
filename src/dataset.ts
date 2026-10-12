export const SEED = 20261011;
export const HOURS = 168;

export type Label = 'legitimate' | 'suspicious';

export interface LabeledSeries {
  id: string;
  label: Label;
  scenario: string;
  views: number[];
}

interface Random {
  uniform(min: number, max: number): number;
  logUniform(min: number, max: number): number;
  integer(min: number, max: number): number;
  normal(): number;
  poisson(mean: number): number;
}

interface Scenario {
  label: Label;
  name: string;
  count: number;
  build(random: Random): number[];
}

function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  const uniform = (min: number, max: number): number => min + (max - min) * next();
  const normal = (): number =>
    Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  const poisson = (mean: number): number => {
    if (mean >= 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal()));
    const limit = Math.exp(-mean);
    let count = 0;
    for (let product = next(); product > limit; product *= next()) count++;
    return count;
  };
  return {
    uniform,
    normal,
    poisson,
    logUniform: (min, max) => Math.exp(uniform(Math.log(min), Math.log(max))),
    integer: (min, max) => Math.floor(uniform(min, max + 1)),
  };
}

function hours<T>(valueAt: (hour: number) => T): T[] {
  return Array.from({ length: HOURS }, (_, hour) => valueAt(hour));
}

function dailyCycle(random: Random): (hour: number) => number {
  const amplitude = random.uniform(0.2, 0.5);
  const phase = random.uniform(0, 24);
  return (hour) => 1 + amplitude * Math.sin((2 * Math.PI * (hour + phase)) / 24);
}

function audience(random: Random, expected: number[]): number[] {
  const noise = random.uniform(0.08, 0.25);
  return expected.map((views) => random.poisson(views * Math.exp(noise * random.normal())));
}

function organic(
  random: Random,
  base: number,
  multiplier: (hour: number) => number = () => 1,
): number[] {
  const cycle = dailyCycle(random);
  return audience(
    random,
    hours((hour) => base * cycle(hour) * multiplier(hour)),
  );
}

function organicBase(random: Random): number {
  return random.logUniform(20, 5000);
}

function withBots(views: number[], botsAt: (hour: number) => number): number[] {
  return views.map((organicViews, hour) => organicViews + Math.round(botsAt(hour)));
}

function steady(random: Random): number[] {
  return organic(random, organicBase(random));
}

function organicViral(random: Random): number[] {
  const start = random.integer(12, 96);
  const riseHours = random.integer(4, 12);
  const gain = random.logUniform(4, 40);
  const halfLife = random.uniform(6, 36);
  return organic(random, organicBase(random), (hour) => {
    const elapsed = hour - start;
    if (elapsed < 0) return 1;
    if (elapsed < riseHours) return 1 + gain * (elapsed / riseHours) ** 2;
    return 1 + gain * 0.5 ** ((elapsed - riseHours) / halfLife);
  });
}

function newVideo(random: Random): number[] {
  const peakHour = random.integer(1, 5);
  const decay = random.uniform(3, 12);
  return organic(random, random.logUniform(200, 20000), (hour) =>
    hour <= peakHour
      ? (hour + 1) / (peakHour + 1)
      : (1 + (hour - peakHour) / decay) ** -1.2,
  );
}

function suddenShare(random: Random): number[] {
  const start = random.integer(12, 120);
  const gain = random.logUniform(4, 20);
  const halfLife = random.uniform(4, 24);
  return organic(random, organicBase(random), (hour) =>
    hour < start ? 1 : 1 + gain * 0.5 ** ((hour - start) / halfLife),
  );
}

function collectionGap(random: Random): number[] {
  const start = random.integer(12, 150);
  const end = random.uniform(0, 1) < 0.5 ? HOURS : start + random.integer(2, 5);
  return organic(random, organicBase(random)).map((views, hour) =>
    hour >= start && hour < end ? 0 : views,
  );
}

function scheduledEvent(random: Random): number[] {
  const start = random.integer(12, 150);
  const end = start + random.integer(2, 5);
  const gain = random.uniform(3, 8);
  const tailHalfLife = random.logUniform(0.2, 2);
  return organic(random, organicBase(random), (hour) => {
    if (hour < start) return 1;
    if (hour < end) return 1 + gain;
    return 1 + gain * 0.5 ** ((hour - end + 1) / tailHalfLife);
  });
}

function boughtPlateau(random: Random): number[] {
  const base = organicBase(random);
  const start = random.integer(12, 140);
  const end = start + random.integer(3, 24);
  const rate = base * random.uniform(5, 40);
  return withBots(organic(random, base), (hour) => (hour >= start && hour < end ? rate : 0));
}

function boughtJittered(random: Random): number[] {
  const base = organicBase(random);
  const start = random.integer(12, 140);
  const end = start + random.integer(3, 24);
  const rate = base * random.uniform(5, 40);
  return withBots(organic(random, base), (hour) =>
    hour >= start && hour < end ? rate * random.uniform(0.9, 1.1) : 0,
  );
}

function mechanicalFlat(random: Random): number[] {
  const rate = Math.round(random.logUniform(100, 5000));
  return withBots(organic(random, random.logUniform(1, 10)), () => rate + random.integer(-2, 2));
}

function dailyBlocks(random: Random): number[] {
  const base = organicBase(random);
  const startOfDay = random.integer(0, 19);
  const blockHours = random.integer(2, 4);
  const rate = base * random.uniform(5, 40);
  return withBots(organic(random, base), (hour) => {
    const hourOfDay = hour % 24;
    return hourOfDay >= startOfDay && hourOfDay < startOfDay + blockHours ? rate : 0;
  });
}

function dripFeed(random: Random): number[] {
  const base = organicBase(random);
  const start = random.integer(12, 72);
  const duration = random.integer(24, 72);
  const peakRate = base * random.uniform(5, 40);
  return withBots(organic(random, base), (hour) => {
    const elapsed = hour - start;
    if (elapsed < 0 || elapsed >= duration) return 0;
    const ramp = Math.sin((Math.PI * elapsed) / duration) ** 2;
    return peakRate * ramp * Math.exp(0.15 * random.normal());
  });
}

function smallBoost(random: Random): number[] {
  const base = organicBase(random);
  const start = random.integer(12, 140);
  const end = start + random.integer(3, 24);
  const rate = base * random.uniform(0.5, 1.5);
  return withBots(organic(random, base), (hour) => (hour >= start && hour < end ? rate : 0));
}

export const SCENARIOS: Scenario[] = [
  { label: 'legitimate', name: 'steady', count: 210, build: steady },
  { label: 'legitimate', name: 'organic_viral', count: 180, build: organicViral },
  { label: 'legitimate', name: 'new_video', count: 90, build: newVideo },
  { label: 'legitimate', name: 'sudden_share', count: 48, build: suddenShare },
  { label: 'legitimate', name: 'collection_gap', count: 36, build: collectionGap },
  { label: 'legitimate', name: 'scheduled_event', count: 36, build: scheduledEvent },
  { label: 'suspicious', name: 'bought_plateau', count: 140, build: boughtPlateau },
  { label: 'suspicious', name: 'bought_jittered', count: 80, build: boughtJittered },
  { label: 'suspicious', name: 'mechanical_flat', count: 80, build: mechanicalFlat },
  { label: 'suspicious', name: 'daily_blocks', count: 40, build: dailyBlocks },
  { label: 'suspicious', name: 'drip_feed', count: 36, build: dripFeed },
  { label: 'suspicious', name: 'small_boost', count: 24, build: smallBoost },
];

export function generateDataset(seed: number = SEED): LabeledSeries[] {
  const random = createRandom(seed);
  return SCENARIOS.flatMap((scenario) =>
    Array.from({ length: scenario.count }, (_, index) => ({
      id: `${scenario.name}-${String(index + 1).padStart(3, '0')}`,
      label: scenario.label,
      scenario: scenario.name,
      views: scenario.build(random),
    })),
  );
}

export function serializeDataset(dataset: LabeledSeries[]): string {
  return dataset.map((series) => JSON.stringify(series)).join('\n') + '\n';
}

export function parseDataset(text: string): LabeledSeries[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as LabeledSeries);
}

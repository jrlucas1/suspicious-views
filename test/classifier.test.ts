import { describe, expect, it } from 'vitest';
import { classify } from '../src/classifier.ts';
import { NO_SIGNAL_REASON, ORGANIC_WEEKDAYS, add, alternating, constant } from './helpers.ts';

const ORGANIC_PEAK = [
  200, 600, 1400, 2800, 4300, 5209, 4600, 4100, 3600, 3200, 2800, 2450, 2150, 1900, 1650, 1450,
  1250, 1100, 950, 820, 700, 600, 500, 420, 350, 290, 240, 200, 160, 130, 100, 80, 60, 40, 20,
];

function detectedSignals(views: number[]): string[] {
  return classify(views)
    .signals.filter((signal) => signal.detected)
    .map((signal) => signal.name);
}

describe('casos óbvios', () => {
  it('audiência comum, com ciclo diário, é legítima', () => {
    const verdict = classify(ORGANIC_WEEKDAYS);

    expect(verdict.classification).toBe('legitimate');
    expect(verdict.reason).toBe(NO_SIGNAL_REASON);
    expect(verdict.signals).toEqual([
      {
        name: 'flat_run',
        detected: false,
        description: 'Nenhuma sequência de 8 horas com números iguais demais.',
        evidence: null,
      },
      {
        name: 'sudden_rise',
        detected: false,
        description: 'Nenhuma hora em que as views subiram 3x ou mais e ficaram no alto.',
        evidence: null,
      },
      {
        name: 'sudden_drop',
        detected: false,
        description: 'Nenhuma hora em que as views caíram 3x ou mais e ficaram embaixo.',
        evidence: null,
      },
    ]);
  });

  it('pico comprado entra e sai de uma vez e é suspeito', () => {
    const views = add(ORGANIC_WEEKDAYS, 30, constant(6, 5000));

    const verdict = classify(views);

    expect(verdict.classification).toBe('suspicious');
    expect(verdict.reason).toBe(
      'As views subiram 83,2x na hora 30 (de 61 para 5.077 por hora). ' +
        'Ficaram 6 horas nesse patamar. ' +
        'As views caíram 15,9x na hora 36 (de 5.264 para 331 por hora). ' +
        'Pico de audiência real perde força aos poucos. ' +
        'Este entrou e saiu de uma vez, como pacote de views comprado.',
    );
    expect(verdict.signals[1]).toEqual({
      name: 'sudden_rise',
      detected: true,
      description: 'As views subiram 83,2x na hora 30 (de 61 para 5.077 por hora).',
      evidence: { hour: 30, before: 61, after: 5077, factor: 5077 / 61 },
    });
    expect(verdict.signals[2]).toEqual({
      name: 'sudden_drop',
      detected: true,
      description: 'As views caíram 15,9x na hora 36 (de 5.264 para 331 por hora).',
      evidence: { hour: 36, before: 5264, after: 331, factor: 5264 / 331 },
    });
  });

  it('pico orgânico da mesma altura sobe e desce aos poucos e é legítimo', () => {
    const organic = add(ORGANIC_WEEKDAYS, 25, ORGANIC_PEAK);
    const bought = add(ORGANIC_WEEKDAYS, 30, constant(6, 5000));

    expect(Math.max(...organic)).toBe(5286);
    expect(Math.max(...bought)).toBe(5286);
    expect(classify(organic).classification).toBe('legitimate');
    expect(classify(organic).reason).toBe(NO_SIGNAL_REASON);
    expect(classify(bought).classification).toBe('suspicious');
  });

  it('a mesma quantidade toda hora é entrega automática e é suspeita', () => {
    const views = [...constant(12, 3), 500, 501, 500, 499, 500, 502, 500, 498, 500, 501, 500, 500];

    const verdict = classify(views);

    expect(verdict.classification).toBe('suspicious');
    expect(verdict.reason).toBe(
      'Das horas 12 a 23, as views ficaram entre 498 e 502 por hora. ' +
        'Audiência real nesse volume oscila pelo menos 22 views de uma hora para outra. ' +
        'Números tão iguais indicam entrega automática.',
    );
    expect(verdict.signals[0]).toEqual({
      name: 'flat_run',
      detected: true,
      description:
        'Das horas 12 a 23, as views ficaram entre 498 e 502 por hora. ' +
        'Audiência real nesse volume oscila pelo menos 22 views de uma hora para outra.',
      evidence: { startHour: 12, endHour: 23, min: 498, max: 502, naturalSpread: 22 },
    });
  });

  it('pico em caixa com números iguais cita os dois motivos', () => {
    const views = add(ORGANIC_WEEKDAYS, 30, constant(10, 90000));

    const verdict = classify(views);

    expect(verdict.classification).toBe('suspicious');
    expect(detectedSignals(views)).toEqual(['flat_run', 'sudden_rise', 'sudden_drop']);
    expect(verdict.reason).toContain('Números tão iguais indicam entrega automática.');
    expect(verdict.reason).toContain('como pacote de views comprado.');
  });
});

describe('prefere não acusar', () => {
  it('subida brusca com queda gradual é inconclusiva', () => {
    const tail = [4000, 3700, 3300, 2900, 2500, 2100, 1800, 1500, 1200, 950, 750, 550, 400, 250, 120];
    const views = add(ORGANIC_WEEKDAYS, 30, tail);

    const verdict = classify(views);

    expect(verdict.classification).toBe('inconclusive');
    expect(verdict.reason).toBe(
      'As views subiram 62,6x na hora 30 (de 61 para 3.821 por hora). ' +
        'Depois disso não houve queda brusca. ' +
        'Subida rápida com queda gradual acontece quando o vídeo é compartilhado por um perfil grande. ' +
        'Não há evidência suficiente para acusar.',
    );
    expect(detectedSignals(views)).toEqual(['sudden_rise']);
  });

  it('queda brusca sem pico antes é inconclusiva', () => {
    const views = ORGANIC_WEEKDAYS.map((hourViews, hour) => (hour >= 40 ? 0 : hourViews));

    const verdict = classify(views);

    expect(verdict.classification).toBe('inconclusive');
    expect(verdict.reason).toBe(
      'As views caíram 288x na hora 40 (de 288 para 0 por hora). ' +
        'Não houve subida brusca antes. ' +
        'Vídeo removido ou falha na coleta dos dados explicam uma queda assim. ' +
        'Não há evidência suficiente para acusar.',
    );
    expect(detectedSignals(views)).toEqual(['sudden_drop']);
  });

  it('falha de coleta (queda e volta) não é pico em caixa', () => {
    const views = ORGANIC_WEEKDAYS.map((hourViews, hour) => (hour >= 40 && hour < 43 ? 0 : hourViews));

    const verdict = classify(views);

    expect(verdict.classification).toBe('inconclusive');
    expect(detectedSignals(views)).toEqual(['sudden_rise', 'sudden_drop']);
    expect(verdict.reason).toContain('As duas mudanças não formam um pico que entra e sai de uma vez.');
  });

  it('pico que já tinha perdido mais da metade da força antes da queda não é caixa', () => {
    const fading = add(alternating(48, 100, 90), 20, [6000, 6000, 4500, 3500, 2900, 2900]);
    const holding = add(alternating(48, 100, 90), 20, [6000, 6000, 4500, 3500, 3000, 3000]);

    expect(classify(fading).classification).toBe('inconclusive');
    expect(classify(holding).classification).toBe('suspicious');
  });

  it('com duas subidas, o motivo cita a que forma a caixa, não a maior', () => {
    const sharedThenFaded = [
      9000, 8000, 7000, 6000, 5000, 4200, 3500, 2900, 2400, 2000, 1600, 1300, 1000, 800, 600, 450,
      300, 200, 100, 50,
    ];
    const views = add(add(alternating(72, 100, 90), 10, sharedThenFaded), 50, constant(4, 2000));

    const verdict = classify(views);

    expect(verdict.classification).toBe('suspicious');
    expect(verdict.signals[1]?.evidence).toEqual({ hour: 50, before: 100, after: 2090, factor: 20.9 });
    expect(verdict.signals[2]?.evidence).toEqual({ hour: 54, before: 2090, after: 100, factor: 20.9 });
    expect(classify(views.slice(0, 48)).signals[1]?.evidence).toEqual({
      hour: 10,
      before: 100,
      after: 8090,
      factor: 80.9,
    });
  });

  it('pico de uma hora só não é acusado', () => {
    const views = add(ORGANIC_WEEKDAYS, 30, [5000]);

    expect(classify(views).classification).toBe('legitimate');
  });

  it('volume baixo não gera sinal', () => {
    const jumpy = [...constant(12, 2), ...constant(6, 60), ...constant(12, 2)];
    const identical = constant(48, 49);

    expect(classify(jumpy).classification).toBe('legitimate');
    expect(classify(identical).classification).toBe('legitimate');
    expect(classify(constant(24, 0)).classification).toBe('legitimate');
  });
});

describe('limites dos sinais', () => {
  it('subida conta a partir de 3x', () => {
    const below = [...alternating(12, 90, 100), ...alternating(12, 299, 330)];
    const exact = [...alternating(12, 90, 100), ...alternating(12, 300, 330)];

    expect(detectedSignals(below)).toEqual([]);
    expect(detectedSignals(exact)).toEqual(['sudden_rise']);
  });

  it('subida conta a partir de 100 views de diferença', () => {
    const below = [...constant(12, 10), 109, 140, 180, 150, 120, 160, 190, 150, 110, 170, 140, 120];
    const exact = [...constant(12, 10), 110, 140, 180, 150, 120, 160, 190, 150, 110, 170, 140, 120];

    expect(detectedSignals(below)).toEqual([]);
    expect(detectedSignals(exact)).toEqual(['sudden_rise']);
  });

  it('queda conta a partir de 3x e de 100 views de diferença', () => {
    const noisy = [300, 340, 280, 360, 310, 290, 350, 270, 330, 300, 360, 300];
    const below = [...noisy, ...alternating(12, 101, 80)];
    const exact = [...noisy, ...alternating(12, 100, 80)];
    const smallLoss = [...alternating(12, 170, 148), ...alternating(12, 49, 40)];
    const enoughLoss = [...alternating(12, 170, 149), ...alternating(12, 49, 40)];

    expect(detectedSignals(below)).toEqual([]);
    expect(detectedSignals(exact)).toEqual(['sudden_drop']);
    expect(detectedSignals(smallLoss)).toEqual([]);
    expect(detectedSignals(enoughLoss)).toEqual(['sudden_drop']);
  });

  it('mudança brusca precisa durar duas horas', () => {
    const lastHourRise = [...ORGANIC_WEEKDAYS.slice(0, 23), 9000];
    const lastHourDrop = [...ORGANIC_WEEKDAYS.slice(0, 23), 0];

    expect(detectedSignals(lastHourRise)).toEqual([]);
    expect(detectedSignals(lastHourDrop)).toEqual([]);
  });

  it('números iguais contam a partir de 8 horas seguidas', () => {
    const noisy = [300, 340, 280, 360, 310, 290, 350, 270, 330, 300, 360, 300];
    const seven = [...noisy, ...constant(7, 320), ...noisy];
    const eight = [...noisy, ...constant(8, 320), ...noisy];

    expect(detectedSignals(seven)).toEqual([]);
    expect(detectedSignals(eight)).toEqual(['flat_run']);
    expect(classify(eight).signals[0]?.evidence).toEqual({
      startHour: 12,
      endHour: 19,
      min: 320,
      max: 320,
      naturalSpread: 18,
    });
  });

  it('números iguais contam a partir de 50 views por hora', () => {
    expect(detectedSignals(constant(24, 49))).toEqual([]);
    expect(detectedSignals(constant(24, 50))).toEqual(['flat_run']);
  });

  it('variação do tamanho do acaso não é número igual demais', () => {
    const natural = [400, 421, 385, 409, 378, 415, 392, 430, 397, 372, 411, 388];
    const tooEven = [400, 402, 398, 401, 399, 403, 397, 400, 402, 398, 401, 399];

    expect(detectedSignals([...natural, ...natural])).toEqual([]);
    expect(detectedSignals([...tooEven, ...tooEven])).toEqual(['flat_run']);
  });

  it('a mesma série recebe sempre o mesmo veredito', () => {
    const views = add(ORGANIC_WEEKDAYS, 30, constant(6, 5000));
    const copy = [...views];

    expect(classify(views)).toEqual(classify(views));
    expect(views).toEqual(copy);
  });
});

import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { NO_SIGNAL_REASON, ORGANIC_WEEKDAYS, add, constant } from './helpers.ts';

const app = buildApp();

const INVALID_VIEWS_MESSAGE =
  'Envie "views" com 24 a 2160 inteiros não negativos, um por hora, e nenhum outro campo.';

async function classifyRequest(payload: unknown) {
  const response = await app.inject({
    method: 'POST',
    url: '/classify',
    payload: payload as Record<string, unknown>,
  });
  return { status: response.statusCode, body: response.json() };
}

describe('POST /classify', () => {
  it('devolve classificação, motivo e os três sinais', async () => {
    const { status, body } = await classifyRequest({ views: ORGANIC_WEEKDAYS });

    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(['classification', 'reason', 'signals']);
    expect(body.classification).toBe('legitimate');
    expect(body.reason).toBe(NO_SIGNAL_REASON);
    expect(body.signals.map((signal: { name: string }) => signal.name)).toEqual([
      'flat_run',
      'sudden_rise',
      'sudden_drop',
    ]);
  });

  it('acusa o pico comprado com o motivo e a evidência', async () => {
    const { status, body } = await classifyRequest({
      views: add(ORGANIC_WEEKDAYS, 30, constant(6, 5000)),
    });

    expect(status).toBe(200);
    expect(body.classification).toBe('suspicious');
    expect(body.reason).toContain('As views subiram 83,2x na hora 30 (de 61 para 5.077 por hora).');
    expect(body.signals[2]).toEqual({
      name: 'sudden_drop',
      detected: true,
      description: 'As views caíram 15,9x na hora 36 (de 5.264 para 331 por hora).',
      evidence: { hour: 36, before: 5264, after: 331, factor: 5264 / 331 },
    });
  });

  it('aceita a série mais curta e a mais longa', async () => {
    const shortest = await classifyRequest({ views: constant(24, 10) });
    const longest = await classifyRequest({ views: constant(2160, 10) });

    expect(shortest.status).toBe(200);
    expect(longest.status).toBe(200);
    expect(longest.body.classification).toBe('legitimate');
  });
});

describe('entrada inválida', () => {
  it.each([
    ['série curta demais', { views: constant(23, 10) }],
    ['série longa demais', { views: constant(2161, 10) }],
    ['views negativas', { views: [...constant(23, 10), -1] }],
    ['views fracionadas', { views: [...constant(23, 10), 1.5] }],
    ['views acima do limite', { views: [...constant(23, 10), 1_000_000_001] }],
    ['views como texto', { views: [...constant(23, 10), '10'] }],
    ['views nulas', { views: [...constant(23, 10), null] }],
    ['views que não são lista', { views: '10,10,10' }],
    ['corpo sem views', {}],
    ['campo desconhecido', { views: constant(24, 10), classification: 'legitimate' }],
  ])('recusa %s', async (_name, payload) => {
    const { status, body } = await classifyRequest(payload);

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'invalid_payload', message: INVALID_VIEWS_MESSAGE });
  });

  it('JSON malformado responde 400 invalid_payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/classify',
      headers: { 'content-type': 'application/json' },
      payload: '{oops',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'invalid_payload',
      message: 'O corpo não é um JSON válido.',
    });
  });

  it('rota que não existe responde 404 no formato da API', async () => {
    const response = await app.inject({ method: 'GET', url: '/classify' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found', message: 'Rota não existe.' });
  });
});

import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import { classify } from './classifier.ts';
import { MAX_HOURS, MIN_HOURS, STRICT_VALIDATION, classifyBody } from './schemas.ts';
import type { ClassifyBody } from './schemas.ts';

export interface AppOptions {
  logger?: boolean;
}

const CLIENT_ERROR_MESSAGES: Record<string, string> = {
  FST_ERR_CTP_INVALID_JSON_BODY: 'O corpo não é um JSON válido.',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'O corpo está vazio, mas o content-type é JSON.',
  FST_ERR_VALIDATION:
    `Envie "views" com ${MIN_HOURS} a ${MAX_HOURS} inteiros não negativos, ` +
    `um por hora, e nenhum outro campo.`,
};

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    ajv: { customOptions: STRICT_VALIDATION },
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'not_found', message: 'Rota não existe.' }),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.statusCode !== undefined && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: 'invalid_payload',
        message: CLIENT_ERROR_MESSAGES[error.code] ?? error.message,
      });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'internal_error', message: 'Erro interno.' });
  });

  app.post<{ Body: ClassifyBody }>('/classify', { schema: { body: classifyBody } }, (request) =>
    classify(request.body.views),
  );

  return app;
}

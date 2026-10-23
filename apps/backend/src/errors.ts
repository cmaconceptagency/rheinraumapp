import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ERROR_MESSAGES, type ErrorCode } from '@rheinraum/shared';

const STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  ACCOUNT_INACTIVE: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  UPLOAD_INVALID: 400,
  UPLOAD_TOO_LARGE: 413,
  TIME_ORDER: 400,
  INVITE_INVALID: 400,
  RATE_LIMITED: 429,
  ROUTING_FAILED: 502,
  INTERNAL: 500,
};

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    public details?: unknown,
    public status: number = STATUS[code] ?? 409,
  ) {
    super(ERROR_MESSAGES[code]);
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | ApiError | ZodError, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION',
          message: ERROR_MESSAGES.VALIDATION,
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    const fe = err as FastifyError;
    if (fe.statusCode === 429) {
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: ERROR_MESSAGES.RATE_LIMITED } });
    }
    if (fe.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({ error: { code: 'UPLOAD_TOO_LARGE', message: ERROR_MESSAGES.UPLOAD_TOO_LARGE } });
    }
    if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
      return reply.status(fe.statusCode).send({ error: { code: 'VALIDATION', message: fe.message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: ERROR_MESSAGES.INTERNAL } });
  });
}

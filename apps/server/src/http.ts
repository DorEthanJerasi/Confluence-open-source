import type { FastifyInstance } from 'fastify';
import { ZodError, type ZodType } from 'zod';

/** An error with an HTTP status that the error handler turns into JSON. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);
export const forbidden = (msg = 'You do not have permission to do that') => new HttpError(403, 'forbidden', msg);
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Please log in');
export const badRequest = (msg: string) => new HttpError(400, 'bad_request', msg);
export const conflict = (code: string, msg: string) => new HttpError(409, code, msg);

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value ?? {});
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route ids that are not UUIDs can never match a row: answer 404, not a DB error. */
export function uuidParam(v: string, what = 'Not found'): string {
  if (!UUID_RE.test(v)) throw notFound(what);
  return v;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const where = first?.path.length ? `${first.path.join('.')}: ` : '';
      return reply.status(400).send({ error: 'invalid', message: `${where}${first?.message ?? 'Invalid input'}` });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: 'bad_request', message: (err as Error).message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'server_error', message: 'Something went wrong' });
  });
}

import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ZodTypeAny, z } from "zod";

/**
 * An error carrying the HTTP status it should be reported with. Anything else
 * that reaches the error handler is treated as an unexpected 500.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): HttpError =>
  new HttpError(400, message, details);

export const notFound = (message = "Not found"): HttpError =>
  new HttpError(404, message);

/**
 * Validate (and strip unknown keys from) a request body. Unknown keys are
 * dropped rather than persisted, which keeps clients from writing columns the
 * API never exposes (`id`, `createdAt`, ...).
 */
export function parseBody<S extends ZodTypeAny>(
  schema: S,
  body: unknown,
): z.infer<S> {
  const result = schema.safeParse(body ?? {});

  if (!result.success) {
    throw badRequest(
      "Invalid request body",
      result.error.flatten().fieldErrors,
    );
  }

  return result.data;
}

/** Validate query string parameters the same way as bodies. */
export function parseQuery<S extends ZodTypeAny>(
  schema: S,
  query: unknown,
): z.infer<S> {
  const result = schema.safeParse(query ?? {});

  if (!result.success) {
    throw badRequest(
      "Invalid query parameters",
      result.error.flatten().fieldErrors,
    );
  }

  return result.data;
}

/**
 * `Number("abc")` is `NaN`, which Postgres rejects with a driver error — so
 * ids are validated here and reported as 400s instead of 500s.
 */
export function parseId(raw: string | undefined): number {
  const id = Number(raw);

  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest(`Invalid id: "${raw ?? ""}"`);
  }

  return id;
}

/** Drizzle throws on `.set({})`, so an empty patch is rejected up front. */
export function assertHasUpdates<T extends object>(values: T): T {
  if (Object.keys(values).length === 0) {
    throw badRequest("Request body must contain at least one field to update");
  }

  return values;
}

/** Returns the row, or raises a 404 when the id matched nothing. */
export function requireRow<T>(row: T | undefined, message: string): T {
  if (row === undefined) {
    throw notFound(message);
  }

  return row;
}

/**
 * multer signals a rejected upload by throwing its own error type. Left
 * alone these surface as 500s, which reads as "the app is broken" when the
 * truth is "that photo is too large" — a difference that matters to someone
 * who has just watched an upload fail.
 */
function asHttpError(err: unknown): HttpError | null {
  if (err instanceof HttpError) return err;

  const code = (err as { code?: unknown } | null)?.code;

  if (code === "LIMIT_FILE_SIZE") {
    return new HttpError(413, "That file is too large. The limit is 50 MB.");
  }

  if (code === "LIMIT_FILE_COUNT" || code === "LIMIT_UNEXPECTED_FILE") {
    return new HttpError(400, "Please attach a single file.");
  }

  return null;
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const httpError = asHttpError(err);
  const status = httpError?.status ?? 500;

  if (status >= 500) {
    req.log.error({ err }, "Unhandled error");
  } else {
    req.log.warn({ err: { message: err?.message } }, "Request rejected");
  }

  res.status(status).json({
    error: httpError ? httpError.message : "Internal server error",
    ...(httpError?.details === undefined ? {} : { details: httpError.details }),
  });
};

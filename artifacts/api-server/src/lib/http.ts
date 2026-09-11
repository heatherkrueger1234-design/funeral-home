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
/**
 * The driver's error code, wherever it ended up.
 *
 * Drizzle wraps anything the driver throws in a `_DrizzleQueryError` carrying
 * the query it failed on, and puts the original underneath as `cause`. So the
 * PostgreSQL SQLSTATE is one level down, and a check that only reads
 * `err.code` silently never matches — which is how a null byte kept coming
 * back as a 500 after it was supposedly handled.
 */
function driverCode(err: unknown): string | undefined {
  for (let current = err, depth = 0; current && depth < 4; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}

function asHttpError(err: unknown): HttpError | null {
  if (err instanceof HttpError) return err;

  const code = driverCode(err);

  if (code === "LIMIT_FILE_SIZE") {
    return new HttpError(413, "That file is too large. The limit is 50 MB.");
  }

  if (code === "LIMIT_FILE_COUNT" || code === "LIMIT_UNEXPECTED_FILE") {
    return new HttpError(400, "Please attach a single file.");
  }

  /*
   * A body express could not parse.
   *
   * This was a 500 on every POST and PUT in the API — a client with a
   * serialisation hiccup was told the server had failed, and the logs filled
   * with stack traces that looked like a fault here. It is a bad request, and
   * the status has to say so, or nobody can tell a real outage from a
   * malformed payload.
   *
   * `express.json` raises a SyntaxError carrying a `body` property and a 400
   * `status`; `type: "entity.too.large"` is the separate case of a body past
   * the configured limit.
   */
  if (code === "entity.too.large") {
    return new HttpError(413, "That request was too large.");
  }

  if (
    err instanceof SyntaxError &&
    "body" in (err as object) &&
    (err as { status?: number }).status === 400
  ) {
    return new HttpError(400, "That request body was not valid JSON.");
  }

  /*
   * PostgreSQL refuses a null byte anywhere in a text value, and there is no
   * escaping that makes it acceptable — the type genuinely cannot hold one.
   * It arrives from a paste out of a binary file or a probe, and it was
   * reaching the driver and coming back as a 500 from the public front door.
   *
   * 22021 is `character_not_in_repertoire`, which is the same answer for any
   * byte sequence the column's encoding cannot represent.
   */
  if (code === "22021") {
    return new HttpError(
      400,
      "That contained a character we cannot store. Please retype it.",
    );
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

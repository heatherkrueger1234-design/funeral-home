/**
 * These are integration tests: a real Express app against a real Postgres.
 *
 * The property most worth protecting here — that one account can never reach
 * another's data — lives in the interaction between middleware, query
 * builders and foreign keys. A mocked database would happily confirm queries
 * that Postgres would reject, and would have been perfectly happy with the
 * unscoped queries this suite exists to prevent coming back.
 */
import { beforeAll } from "vitest";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must point at a disposable test database — these tests " +
      "truncate every table between cases.",
  );
}

// Deterministic key so encryption assertions do not depend on the environment.
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.NODE_ENV = "test";

beforeAll(() => {
  if (/prod/i.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run destructive tests against that database.");
  }
});

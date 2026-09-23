import app from "./app";
import { logger } from "./lib/logger";
import { assertEncryptionConfigured } from "@workspace/db/crypto";
import { bootstrapPlatformAdmins } from "./lib/platform-auth";

// Documents hold passwords and medical records. Refusing to start is the
// right failure mode: the alternative is accepting them and writing them
// to disk in the clear.
assertEncryptionConfigured();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, () => {
  logger.info({ port }, "Server listening");
});

/*
 * Seed the first platform admin, if the table is empty and the environment
 * names one.
 *
 * After `listen` rather than before it, and never fatal. This is a convenience
 * for the first start of a fresh deployment; a database that is briefly
 * unreachable must not stop the server coming up, because every screen in both
 * apps failing is a much worse outcome than an admin console nobody can reach
 * for one restart. See `lib/platform-auth.ts` for why it only ever runs once.
 */
void bootstrapPlatformAdmins().catch((err: unknown) => {
  logger.error({ err }, "Could not seed the platform admin list");
});

// `listen`'s callback only fires on success — startup failures (EADDRINUSE and
// friends) arrive as an "error" event, which is fatal if left unhandled.
server.on("error", (err) => {
  logger.error({ err }, "Server failed to start");
  process.exit(1);
});

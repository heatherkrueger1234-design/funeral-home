import app from "./app";
import { logger } from "./lib/logger";
import { assertEncryptionConfigured } from "@workspace/db/crypto";

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

// `listen`'s callback only fires on success — startup failures (EADDRINUSE and
// friends) arrive as an "error" event, which is fatal if left unhandled.
server.on("error", (err) => {
  logger.error({ err }, "Server failed to start");
  process.exit(1);
});

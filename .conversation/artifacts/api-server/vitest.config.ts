import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // These are integration tests against one shared Postgres database and
    // they truncate between cases, so they cannot run concurrently.
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
    testTimeout: 20_000,
  },
});

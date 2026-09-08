import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // No unit tests here yet; the behaviour worth pinning lives in the API
    // server's integration suite. Without this, `pnpm -r test` fails the
    // whole workspace on an app that simply has nothing to run.
    passWithNoTests: true,
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});

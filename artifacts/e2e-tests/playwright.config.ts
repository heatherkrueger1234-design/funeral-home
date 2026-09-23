import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import {
  API_PORT,
  FAMILY_PORTAL_PORT,
  DIRECTOR_CONSOLE_PORT,
  apiBase,
} from "./ports";

/**
 * Real-browser coverage of the two things this product actually promises: a
 * director opening a case from the console, and a family opening the texted
 * link and using the thread. Everything else here — vitest against
 * supertest, integration tests against a real Postgres — never renders a
 * single page. This is the one suite that does.
 *
 * Each app is started fresh (build, then serve/start) so the suite is
 * self-sufficient regardless of what a CI job already ran, and each frontend
 * is pointed at the same running api-server through vite's preview proxy,
 * the same way nginx does it in production (see deploy/nginx.conf.template).
 */

const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/funeral_home_e2e";
/*
 * A fresh key each run, not the fixed one the unit tests use.
 *
 * This suite starts the API with NODE_ENV=production, because the point is to
 * exercise the production bundle — and `lib/db/crypto.ts` refuses to start in
 * production on the public CI key, correctly, since that value is in version
 * control and protects nothing. Defaulting to it here meant the web server
 * could not boot at all and no test in this directory had ever run.
 *
 * Generating one is safe because the database is created fresh for the run: no
 * ciphertext outlives the key. Set ENCRYPTION_KEY to pin it if you need to
 * inspect the database afterwards.
 */
const encryptionKey =
  process.env.ENCRYPTION_KEY ??
  randomBytes(32).toString("base64");

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : "list",

  globalSetup: "./global-setup.ts",

  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      // Built and started fresh, not reused, so a stale dist/ from an
      // earlier `pnpm run build` can never be what the suite exercises.
      command:
        "pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/api-server run start",
      cwd: "../..",
      url: `${apiBase}/api/healthz`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: databaseUrl,
        ENCRYPTION_KEY: encryptionKey,
        PORT: String(API_PORT),
        NODE_ENV: "production",
        TASK_SECRET: "e2e-task-secret",
        FAMILY_PORTAL_URL: `http://localhost:${FAMILY_PORTAL_PORT}`,
        CONSOLE_URL: `http://localhost:${DIRECTOR_CONSOLE_PORT}`,
        /*
         * Each front end is on its own port here and the API is on a third, so
         * a browser write carries an Origin the API does not recognise as its
         * own Host and `rejectCrossOriginWrites` refuses it — which is the
         * check doing its job, not a bug in it. `CORS_ORIGINS` is the escape
         * hatch `lib/cors.ts` documents for exactly this: "a separate dev
         * server".
         *
         * Neither real deployment needs it. Under Docker each app's nginx
         * serves the bundle and proxies /api on the same hostname, and on
         * Replit all of it is one domain, so Origin and Host already agree.
         */
        CORS_ORIGINS: [
          `http://localhost:${FAMILY_PORTAL_PORT}`,
          `http://localhost:${DIRECTOR_CONSOLE_PORT}`,
        ].join(","),
      },
    },
    {
      command:
        "pnpm --filter @workspace/family-portal run build && pnpm --filter @workspace/family-portal run serve",
      cwd: "../..",
      url: `http://localhost:${FAMILY_PORTAL_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        PORT: String(FAMILY_PORTAL_PORT),
        E2E_API_PROXY_TARGET: apiBase,
      },
    },
    {
      command:
        "pnpm --filter @workspace/director-console run build && pnpm --filter @workspace/director-console run serve",
      cwd: "../..",
      url: `http://localhost:${DIRECTOR_CONSOLE_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        PORT: String(DIRECTOR_CONSOLE_PORT),
        E2E_API_PROXY_TARGET: apiBase,
      },
    },
  ],
});

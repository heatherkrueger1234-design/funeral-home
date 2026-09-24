import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import {
  API_PORT,
  FAMILY_PORTAL_PORT,
  DIRECTOR_CONSOLE_PORT,
  ADMIN_CONSOLE_PORT,
  PLATFORM_ADMIN_EMAIL,
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
 *
 * The public key is rejected here rather than merely not defaulted to. A plain
 * `?? randomBytes(...)` fallback is not enough: every other CI job exports that
 * value, and one line of it left in this job's `env:` silently defeated the fix
 * and kept the suite red while it passed locally, where nothing sets it. An
 * ambient value that cannot work should not be honoured.
 */
const KNOWN_TEST_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const providedKey = process.env.ENCRYPTION_KEY;
const encryptionKey =
  providedKey && providedKey !== KNOWN_TEST_KEY
    ? providedKey
    : randomBytes(32).toString("base64");

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
        // Read once, into an empty table, at boot. admin-console.spec.ts
        // registers the matching staff account itself.
        PLATFORM_ADMIN_EMAILS: PLATFORM_ADMIN_EMAIL,
        FAMILY_PORTAL_URL: `http://localhost:${FAMILY_PORTAL_PORT}`,
        CONSOLE_URL: `http://localhost:${DIRECTOR_CONSOLE_PORT}`,
        /*
         * No CORS_ORIGINS. Each front end is on its own port here and the API
         * is on a third, so a browser write used to carry an Origin the API
         * did not recognise as its own Host and `rejectCrossOriginWrites`
         * refused it — the check doing its job. The escape hatch was the
         * obvious fix and the wrong one: it made the suite pass by switching
         * off the control, so the one test that renders a real page was the one
         * place that control was never exercised.
         *
         * Each front end's vite preview proxy now passes Host through
         * unchanged, which is what nginx and Caddy do in the real deployments,
         * so Origin and Host agree here for the same reason they agree in
         * production and the check passes on its own terms.
         */
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
    {
      command:
        "pnpm --filter @workspace/admin-console run build && pnpm --filter @workspace/admin-console run serve",
      cwd: "../..",
      url: `http://localhost:${ADMIN_CONSOLE_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        PORT: String(ADMIN_CONSOLE_PORT),
        E2E_API_PROXY_TARGET: apiBase,
      },
    },
  ],
});

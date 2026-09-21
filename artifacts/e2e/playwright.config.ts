import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * The end-to-end suite: the real bundles, the real API, a real database.
 *
 * There were 243 tests before this file existed and all of them were
 * server-side. They are good tests and they could not have caught the two
 * worst bugs this product has had — a family's photographs never rendering,
 * and the opening request of every cold load going out without its
 * credential — because both lived in the half-inch between a browser and an
 * endpoint that answered correctly when asked correctly. `supertest` always
 * asks correctly. A browser does not.
 *
 * So: no mocks and no dev server. The apps under test are the same bundles
 * `pnpm run build` produces, served by the same shape of static-plus-proxy
 * that nginx provides in production, against an Express process talking to
 * Postgres. If it passes here it has passed on the arrangement people
 * actually deploy.
 *
 * Run it with:
 *
 *   pnpm run build
 *   pnpm --filter @workspace/db run push-force
 *   pnpm --filter @workspace/e2e run test:e2e
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

const API_PORT = Number(process.env["E2E_API_PORT"] ?? 4399);
const PORTAL_PORT = Number(process.env["E2E_PORTAL_PORT"] ?? 4390);
const CONSOLE_PORT = Number(process.env["E2E_CONSOLE_PORT"] ?? 4391);

export const PORTAL = `http://127.0.0.1:${PORTAL_PORT}`;
export const CONSOLE = `http://127.0.0.1:${CONSOLE_PORT}`;

/**
 * A fixed key, and it must never become a deployed one.
 *
 * `assertEncryptionConfigured` refuses to start the server without it, which
 * is correct — this database holds social security numbers. CI sets the same
 * value for the unit suite.
 */
const ENCRYPTION_KEY =
  process.env["ENCRYPTION_KEY"] ?? "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://postgres:postgres@localhost:5432/funeral_home_test";

/**
 * Normally Playwright finds the browser it shipped with, which is what
 * `playwright install` puts there and what CI does.
 *
 * `E2E_CHROMIUM` is for the other case: a sandbox or a locked-down runner
 * that already has a Chromium at a fixed path and no way to download the
 * exact revision this version prefers. It is an escape hatch rather than
 * configuration, and nothing in CI sets it.
 */
const executablePath = process.env["E2E_CHROMIUM"] || undefined;

export default defineConfig({
  testDir: "./tests",
  // Every spec builds its own home, its own case and its own family link
  // through the API, so nothing shares state and the order does not matter.
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: process.env["CI"] ? 2 : undefined,
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    // A phone, because that is what the family portal is opened on and the
    // desktop projects below override it where a director is meant.
    ...devices["Pixel 7"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: executablePath ? { executablePath } : {},
  },

  projects: [
    {
      name: "family",
      testMatch: /family\.spec\.ts/,
      use: { ...devices["Pixel 7"], launchOptions: executablePath ? { executablePath } : {} },
    },
    {
      name: "console",
      testMatch: /(console|handoff)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
    {
      name: "both",
      testMatch: /(consent|link)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],

  webServer: [
    {
      command: `node --enable-source-maps ${path.join(ROOT, "artifacts/api-server/dist/index.mjs")}`,
      port: API_PORT,
      reuseExistingServer: !process.env["CI"],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PORT: String(API_PORT),
        NODE_ENV: "test",
        DATABASE_URL,
        ENCRYPTION_KEY,
        // Nothing here should try to reach the outside world. With no SMTP
        // the mailer logs instead of sending, which is the behaviour the
        // officiant-brief test asserts on.
        LOG_LEVEL: "warn",
        /*
         * Every spec registers its own home and signs in, so a suite of
         * twenty tests makes forty auth requests from one address inside a
         * minute — which is precisely what the default ceiling of twenty per
         * quarter of an hour exists to stop.
         *
         * Raised rather than switched off, and raised here rather than in
         * the limiter, because the limiter working is itself worth keeping
         * true in the environment under test. `rate-limit.ts` makes these
         * configurable on the grounds that the right number depends on the
         * deployment; a test runner hammering localhost is a deployment.
         */
        AUTH_RATE_LIMIT_MAX: "2000",
        AUTH_RATE_LIMIT_WINDOW_MS: "900000",
      },
    },
    {
      command: `node ${path.join(import.meta.dirname, "serve.mjs")} ${path.join(ROOT, "artifacts/family-portal/dist/public")} ${PORTAL_PORT} ${API_PORT}`,
      port: PORTAL_PORT,
      reuseExistingServer: !process.env["CI"],
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `node ${path.join(import.meta.dirname, "serve.mjs")} ${path.join(ROOT, "artifacts/director-console/dist/public")} ${CONSOLE_PORT} ${API_PORT}`,
      port: CONSOLE_PORT,
      reuseExistingServer: !process.env["CI"],
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});

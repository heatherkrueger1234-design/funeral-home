import { request as playwrightRequest } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { apiBase, PLATFORM_ADMIN_EMAIL } from "./ports";

export const PLATFORM_ADMIN_PASSWORD = "correct-horse-battery-staple-1";

/**
 * The one account that can sign in to the platform console.
 *
 * The api-server is started with PLATFORM_ADMIN_EMAILS naming one address
 * (see playwright.config.ts), and the row is also granted below. Being on
 * that list is not an account, though --
 * a platform admin is an ordinary staff sign-in that is also on the list --
 * so the account is registered here. A second run against the same database
 * finds it already there, which is fine: the password is the same.
 *
 * The console also refuses an address nobody has confirmed, and the
 * confirmation link only exists in an email. So the one shortcut here marks
 * it confirmed in the database directly, the same way global-setup.ts talks
 * to it, rather than weakening that check for tests.
 */
export async function ensurePlatformAdminAccount(): Promise<void> {
  const api = await playwrightRequest.newContext({ baseURL: apiBase });
  await api.post("/api/auth/register", {
    data: {
      homeName: "Continuum (e2e)",
      ownerName: "Platform Admin",
      email: PLATFORM_ADMIN_EMAIL,
      password: PLATFORM_ADMIN_PASSWORD,
    },
  });
  await api.dispose();

  execFileSync(
    "psql",
    [
      process.env.E2E_DATABASE_URL ??
        "postgresql://postgres:postgres@localhost:5432/funeral_home_e2e",
      "-q",
      "-c",
      `UPDATE users SET email_verified = true WHERE email = '${PLATFORM_ADMIN_EMAIL}'`,
      // PLATFORM_ADMIN_EMAILS is only read at boot, into an existing table,
      // and on a fresh database the api-server can boot before global-setup
      // has pushed the schema. So the row is granted here as well; the
      // bootstrap has its own tests in api-server.
      "-c",
      `INSERT INTO platform_admins (email, added_by_email) VALUES ('${PLATFORM_ADMIN_EMAIL}', 'e2e') ON CONFLICT (email) DO NOTHING`,
    ],
    { stdio: "inherit" },
  );
}

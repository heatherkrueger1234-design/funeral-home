import { execSync } from "node:child_process";
import path from "node:path";

/**
 * Pushes the current schema to the e2e database before any webServer starts.
 * The database itself is not created here — same convention as
 * .github/workflows/backup-drill.yml, which creates its scratch database
 * with a plain `psql` step rather than teaching a script to do it. Whatever
 * runs this suite is expected to have already created the database named in
 * DATABASE_URL/E2E_DATABASE_URL, exactly as every other DATABASE_URL in this
 * repo already assumes.
 */
export default function globalSetup(): void {
  const databaseUrl =
    process.env.E2E_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/funeral_home_e2e";

  execSync("pnpm --filter @workspace/db run push-force", {
    cwd: path.resolve(import.meta.dirname, "../.."),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
}

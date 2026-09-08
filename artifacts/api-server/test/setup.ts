import { beforeEach, afterAll } from "vitest";

/**
 * These are integration tests against a real Postgres. There are no mocks of
 * the database, on purpose: most of what could actually go wrong in this
 * codebase is a query that returns the wrong rows — a missing tenant filter,
 * a join that leaks another home's case — and a mocked database cannot fail
 * that way, so it would agree with whatever the code does.
 */

// Must be set before anything imports the crypto module.
process.env["ENCRYPTION_KEY"] ??= "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
process.env["NODE_ENV"] ??= "test";

const { db, pool } = await import("@workspace/db");
const { sql } = await import("drizzle-orm");

/**
 * Truncate rather than recreate. `RESTART IDENTITY` matters more than it
 * looks: sequences that carried over between tests would let a test pass
 * because an id happened to be unique across the whole run rather than
 * because the code scoped its query.
 */
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE
      aftercare_deliveries,
      aftercare_enrollments,
      case_deadlines,
      case_messages,
      case_photos,
      service_selections,
      obituary_drafts,
      family_contacts,
      cases,
      uploads,
      sessions,
      password_resets,
      users,
      funeral_homes
    RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

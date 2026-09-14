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

/*
 * The rate limiters hold their counts in process memory, which no TRUNCATE
 * touches. A file that registers a dozen homes would otherwise exhaust the
 * auth ceiling and fail the *next* file's first test, which is the kind of
 * flake that gets blamed on the database.
 */
const { authRateLimit, familyRateLimit, publicRateLimit } = await import(
  "../src/middleware/rate-limit"
);

/**
 * Truncate rather than recreate. `RESTART IDENTITY` matters more than it
 * looks: sequences that carried over between tests would let a test pass
 * because an id happened to be unique across the whole run rather than
 * because the code scoped its query.
 *
 * **Every table goes in this list.** A table left out does not fail loudly —
 * it survives into the next test, and then into the next run, and eventually
 * something passes or fails for a reason that has nothing to do with the code
 * under test. The platform tables at the top are not reachable from
 * `funeral_homes`, so `CASCADE` never reaches them and they have to be named.
 */
beforeEach(async () => {
  authRateLimit.reset();
  familyRateLimit.reset();
  publicRateLimit.reset();

  await db.execute(
    sql`TRUNCATE TABLE
      platform_audit,
      platform_sessions,
      platform_admins,
      aftercare_deliveries,
      aftercare_enrollments,
      case_deadlines,
      case_messages,
      case_photos,
      service_selections,
      merchandise_selection_items,
      merchandise_selections,
      catalogue_package_items,
      catalogue_packages,
      catalogue_items,
      catalogue_categories,
      storefront_settings,
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

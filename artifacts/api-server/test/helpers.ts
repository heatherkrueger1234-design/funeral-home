import request from "supertest";
import type { Express } from "express";
import { beforeEach } from "vitest";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import app from "../src/app";
import { authRateLimit } from "../src/middleware/rate-limit";

export { app };

const TABLES = [
  "uploads",
  "sessions",
  "password_resets",
  "profile",
  "memories",
  "journal_entries",
  "letters",
  "creative_works",
  "documents",
  "quotes_songs",
  "tribute",
  "todos",
  "affirmations",
  "milestones",
  "stories",
  "signs",
  "belongings",
  "gifts",
  "contacts",
  "obituaries",
  "memorial_choices",
  "shares",
  "keepsakes",
  "album_items",
  "albums",
  "community_reports",
  "community_comments",
  "community_posts",
  "users",
] as const;

/** Every case starts from an empty database, so order never matters. */
export function useCleanDatabase(): void {
  beforeEach(async () => {
    // The limiter counts by IP and every test shares one, so without this a
    // long suite trips it and the failures look like broken auth. The limiter
    // itself is exercised deliberately in auth.test.ts.
    authRateLimit.reset();

    await db.execute(
      sql.raw(
        `TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`,
      ),
    );
  });
}

export type Account = {
  id: number;
  email: string;
  /** The session cookie, ready to hand to `.set("Cookie", …)`. */
  cookie: string;
};

let sequence = 0;

/** Registers a fresh account and returns its signed-in cookie. */
export async function signUp(
  server: Express = app,
  password = "a-long-enough-passphrase",
): Promise<Account> {
  sequence += 1;
  const email = `person${sequence}@example.test`;

  const response = await request(server)
    .post("/api/auth/register")
    .send({ email, password })
    .expect(201);

  const setCookie = response.headers["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];

  return {
    id: response.body.id,
    email,
    cookie: cookies.map((value) => value.split(";")[0]).join("; "),
  };
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

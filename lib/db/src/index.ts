import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

/**
 * An open transaction, as `db.transaction` hands it to its callback. Named
 * here once so a helper that must run inside the caller's transaction can
 * say so in its signature without each file deriving the type again.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export * from "./schema";

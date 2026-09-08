/**
 * Encrypts document rows written before encryption at rest existed.
 *
 * `decrypt()` passes plaintext through unchanged, so an un-migrated database
 * keeps working — this script just stops it from staying that way. It is
 * idempotent: rows already encrypted are recognised by their version prefix
 * and skipped, so running it repeatedly is safe.
 *
 * Usage:
 *   ENCRYPTION_KEY=... DATABASE_URL=... \
 *     pnpm --filter @workspace/scripts run encrypt-existing-documents
 */
import pg from "pg";
import { encrypt, isEncrypted, assertEncryptionConfigured } from "@workspace/db/crypto";

type Row = { id: number; content: string | null; notes: string | null };

async function main(): Promise<void> {
  assertEncryptionConfigured();

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set.");
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query<Row>(
      `SELECT id, content, notes FROM documents ORDER BY id`,
    );

    let changed = 0;

    for (const row of rows) {
      const content =
        row.content && !isEncrypted(row.content) ? encrypt(row.content) : null;
      const notes =
        row.notes && !isEncrypted(row.notes) ? encrypt(row.notes) : null;

      if (!content && !notes) continue;

      await client.query(
        `UPDATE documents
            SET content = COALESCE($2, content),
                notes   = COALESCE($3, notes)
          WHERE id = $1`,
        [row.id, content, notes],
      );
      changed += 1;
    }

    await client.query("COMMIT");
    console.log(
      `Encrypted ${changed} of ${rows.length} document(s). ` +
        `Rows already encrypted were left alone.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Rolled back — the database is unchanged.");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

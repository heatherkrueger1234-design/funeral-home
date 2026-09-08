import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  customType,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType: () => "bytea",
});

/**
 * Uploaded photos and files, stored as bytes in Postgres.
 *
 * The obvious alternative is the local filesystem, which is wrong here: this
 * deploys to an autoscale target with an ephemeral disk, so files written
 * beside the process disappear on the next deploy. Losing a bereaved parent's
 * photographs to a routine redeploy is not a failure mode worth accepting for
 * the convenience of `fs.writeFile`.
 *
 * Object storage would be the answer at scale. At this one — a personal
 * archive, capped per file — bytea is simpler, has no credentials to leak,
 * and gives the property that matters most here: a database backup is a
 * complete backup, photographs included.
 *
 * `data` holds AES-256-GCM ciphertext, same key and format as the documents
 * table.
 */
export const uploadsTable = pgTable(
  "uploads",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("uploads_user_id_idx").on(table.userId)],
);

export type Upload = typeof uploadsTable.$inferSelect;

/** The row without its payload — for listing without loading every byte. */
export type UploadSummary = Omit<Upload, "data">;

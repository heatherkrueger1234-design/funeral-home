import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  customType,
  index,
} from "drizzle-orm/pg-core";
import { funeralHomesTable } from "./funeral-homes";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType: () => "bytea",
});

/**
 * Uploaded bytes: family photographs, and the home's own logo.
 *
 * Stored in Postgres rather than on disk because this deploys to an autoscale
 * target with an ephemeral filesystem — files written beside the process are
 * gone on the next deploy. Losing a family's photographs to a routine
 * redeploy is not a failure mode worth accepting for the convenience of
 * `fs.writeFile`. Object storage is the right answer at scale; at a few
 * hundred cases a month, bytea has no credentials to leak and gives the
 * property that matters most: a database backup is a complete backup.
 *
 * Scoped to the funeral home, not to a user, because most of the rows here
 * are uploaded by families who have no account at all. `uploadedByContactId`
 * records which family member sent it — worth keeping, because the director
 * looking at forty photographs wants to know the six that came from the
 * daughter rather than the cousin.
 *
 * `data` holds AES-256-GCM ciphertext.
 */
export const uploadsTable = pgTable(
  "uploads",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    /**
     * Nullable: the home's logo belongs to no case. Photographs set it, and
     * are deleted with the case.
     */
    caseId: integer("case_id"),
    /** Whichever side sent it. Exactly one of these is set in practice. */
    uploadedByUserId: integer("uploaded_by_user_id"),
    uploadedByContactId: integer("uploaded_by_contact_id"),

    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("uploads_funeral_home_id_idx").on(table.funeralHomeId),
    index("uploads_case_id_idx").on(table.caseId),
  ],
);

export type Upload = typeof uploadsTable.$inferSelect;

/** The row without its payload — for listing without loading every byte. */
export type UploadSummary = Omit<Upload, "data">;

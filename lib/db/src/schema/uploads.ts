import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  customType,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { funeralHomesTable } from "./funeral-homes";
import { casesTable } from "./cases";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType: () => "bytea",
});

/**
 * Uploaded bytes: family photographs, the home's own logo, and the small
 * copies of photographs that grids are drawn from (`thumbnailUploadId`).
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
     * Nullable: the home's logo belongs to no case.
     *
     * The cascade is load-bearing rather than tidy. Without it, deleting a
     * case leaves the encrypted photographs of somebody's dead relative in
     * this table indefinitely -- invisible to every screen, still in every
     * backup, and impossible to answer a deletion request about.
     */
    caseId: integer("case_id").references(() => casesTable.id, {
      onDelete: "cascade",
    }),
    /** Whichever side sent it. Exactly one of these is set in practice. */
    uploadedByUserId: integer("uploaded_by_user_id"),
    uploadedByContactId: integer("uploaded_by_contact_id"),

    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),

    /**
     * A small JPEG of this photograph, for drawing it in a grid, a row or a
     * picker (`?size=thumb`, in `lib/media.ts`). Made the first time it is
     * asked for and kept as an upload of its own, carrying this one's home
     * and case, so it is scoped, erased and left out of an export exactly as
     * this one is. It points back at this row itself when the photograph is
     * already as small as a thumbnail would be. Null until anybody asks.
     *
     * Kept here rather than on the thumbnail because the question is always
     * asked from this side -- "has this photograph got one yet?" -- and it
     * is answered without reading anything but the row already in hand.
     */
    thumbnailUploadId: integer("thumbnail_upload_id").references(
      (): AnyPgColumn => uploadsTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("uploads_funeral_home_id_idx").on(table.funeralHomeId),
    index("uploads_case_id_idx").on(table.caseId),
    // Without it, every upload deleted -- a thousand when a case is erased --
    // would search the whole table for rows pointing at it.
    index("uploads_thumbnail_upload_id_idx").on(table.thumbnailUploadId),
  ],
);

export type Upload = typeof uploadsTable.$inferSelect;

/** The row without its payload — for listing without loading every byte. */
export type UploadSummary = Omit<Upload, "data">;

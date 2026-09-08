import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";
import { uploadsTable } from "./uploads";

/**
 * The photo bin: the feature this whole product is sold on.
 *
 * What it replaces is a director's inbox holding forty blurry attachments
 * from six different email addresses, three of which are the same picture,
 * two of which are screenshots of a picture, and none of which are captioned.
 * Here they arrive in one place, attached to one case, with the sender
 * recorded and the order under the director's control.
 *
 * The cap is 50, which is not a technical limit. A slideshow is watched by a
 * room of people standing up, and past about fifty photographs it stops being
 * a tribute and becomes an endurance test. Saying so up front is kinder than
 * letting a family upload three hundred and then asking them to cut.
 */
export const casePhotosTable = pgTable(
  "case_photos",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    uploadId: integer("upload_id")
      .notNull()
      .references(() => uploadsTable.id, { onDelete: "cascade" }),

    /** Who sent it. Null when a staff member added it themselves. */
    uploadedByContactId: integer("uploaded_by_contact_id"),

    /**
     * "Mum and Dad at Skegness, 1974". Optional, and worth asking for: the
     * captions are what let the director build a slideshow that runs in a
     * sensible order without ringing the family to ask who anyone is.
     */
    caption: text("caption"),

    /* ------------------------------------------------------- the portrait */

    /**
     * The crop, as fractions of the original image (0..1), stored rather than
     * applied. The uploaded bytes are never modified: a family that crops
     * their mother's face badly at midnight can be un-cropped by the director
     * in the morning, and the print shop can be handed the full-resolution
     * original with the crop as instructions.
     *
     * Null when the photograph has never been offered as the portrait.
     */
    cropX: doublePrecision("crop_x"),
    cropY: doublePrecision("crop_y"),
    cropWidth: doublePrecision("crop_width"),
    cropHeight: doublePrecision("crop_height"),

    /** Explicit and stored: the order a family puts a life in is the point. */
    position: integer("position").notNull().default(0),

    /**
     * `hidden` rather than deleted for a photograph a director takes out of
     * the slideshow. Deleting a family's picture of their own mother, because
     * it was too dark to project, is not a thing this software should do
     * behind their back.
     */
    status: text("status").notNull().default("visible"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("case_photos_case_id_idx").on(table.caseId, table.position),
    index("case_photos_funeral_home_id_idx").on(table.funeralHomeId),
  ],
);

export const PHOTO_STATUSES = ["visible", "hidden"] as const;
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];

/** Past this, a slideshow stops being a tribute. */
export const MAX_PHOTOS_PER_CASE = 50;

export const insertCasePhotoSchema = createInsertSchema(casePhotosTable).omit({
  id: true,
  funeralHomeId: true,
  caseId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCasePhoto = z.infer<typeof insertCasePhotoSchema>;
export type CasePhoto = typeof casePhotosTable.$inferSelect;

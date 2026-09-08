import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
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
 * Two distinct jobs, which is why `selected` exists.
 *
 * The **bin** is everything the family sends, and it should be as large as
 * they like. A family that has just lost their mother will go through every
 * album in the house, and telling them to stop at fifty makes them do the
 * painful editing at the worst possible moment -- alone, at midnight, before
 * anyone has helped them. Let them empty the shoebox.
 *
 * The **selection** is what actually runs in the chapel. A slideshow is
 * watched by a room of people standing up, and past about fifty photographs
 * it stops being a tribute and becomes an endurance test. So the cut still
 * has to happen; it just happens later, deliberately, and usually with the
 * director sitting next to them.
 *
 * `position` orders the selection, not the bin. The bin is chronological by
 * upload, which is the only order that means anything for a pile of
 * photographs nobody has looked at yet.
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

    /**
     * Whether this one is in the slideshow.
     *
     * Deliberately not defaulted to true. A family uploading four hundred
     * photographs has not chosen four hundred photographs, and a slideshow
     * that silently contains all of them is worse than one that starts empty
     * and gets filled on purpose. The director can select in bulk in one
     * click, which is the common case for a family who only sent thirty.
     */
    selected: boolean("selected").notNull().default(false),

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

/**
 * A ceiling on the bin, not a curation rule.
 *
 * High enough that no real family meets it -- the largest shoebox anyone has
 * is a few hundred -- and low enough that a broken client looping on upload
 * cannot fill the home's database overnight. If somebody genuinely has more
 * than this, that is a conversation with their director, not an error.
 */
export const MAX_PHOTOS_PER_CASE = 1000;

/**
 * What a watchable slideshow holds. A recommendation shown to whoever is
 * choosing, never enforced: a family who wants sixty for their mother gets
 * sixty.
 */
export const SLIDESHOW_TARGET = 50;

export const insertCasePhotoSchema = createInsertSchema(casePhotosTable).omit({
  id: true,
  funeralHomeId: true,
  caseId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCasePhoto = z.infer<typeof insertCasePhotoSchema>;
export type CasePhoto = typeof casePhotosTable.$inferSelect;

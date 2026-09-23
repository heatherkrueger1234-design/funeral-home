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
     * The staff member who added it, when one did: the print a widow posted
     * to the office, scanned at the front desk. Recorded rather than inferred
     * from a null contact, so a family looking at the bin is told plainly
     * that this one came from the home, and the home can see which of its
     * people put it there. Exactly one of this and `uploadedByContactId` is
     * set on anything added since the column existed.
     */
    uploadedByUserId: integer("uploaded_by_user_id"),

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
     * The year the photograph was taken, where anybody knows it.
     *
     * A year and not a date, because nobody knows the date. What is written
     * on the back of a photograph, or remembered about it, is "1974" or
     * "about 1974" -- and asking for a day and a month produces either a
     * guess dressed as a fact or, much more often, a blank field.
     *
     * This is what makes the memory book's age progression possible: with
     * the case's date of birth it gives "1974, aged 36", which is the
     * caption a family actually wants under a photograph of their mother
     * and cannot easily work out themselves at forty photographs.
     *
     * Null is the ordinary state and always will be. A book whose
     * photographs are undated falls back to the order the family put them
     * in, which is the order they meant.
     */
    takenYear: integer("taken_year"),

    /**
     * Whether this was taken at the funeral itself rather than during the
     * life it was for.
     *
     * The distinction matters in exactly one place and matters a lot there:
     * a photograph of the chapel full of people belongs at the back of the
     * memory book, with the day, not dropped into a progression of
     * childhood pictures because it happens to be the most recent one.
     */
    takenAtService: boolean("taken_at_service").notNull().default(false),

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

export const insertCasePhotoSchema = createInsertSchema(casePhotosTable).omit({
  id: true,
  funeralHomeId: true,
  caseId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCasePhoto = z.infer<typeof insertCasePhotoSchema>;
export type CasePhoto = typeof casePhotosTable.$inferSelect;

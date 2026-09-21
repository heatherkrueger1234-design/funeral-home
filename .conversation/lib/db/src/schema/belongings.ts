import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";

/**
 * What the family brings in, and where it is.
 *
 * This is the least glamorous table in the schema and probably the one that
 * prevents the most damage. A wedding ring that cannot be accounted for is
 * the single worst conversation a funeral director has -- worse than a late
 * hearse, worse than a misspelled obituary -- because the family's grief
 * turns instantly into suspicion, and the home has nothing to point at.
 *
 * Most homes track this on a paper form in a folder. That works right up
 * until the person who filled it in is off, or the item was handed over at
 * the door by a cousin nobody logged.
 *
 * So: every item is a row, with a disposition (does it go with them or come
 * back to the family?), a status (where is it right now?), and a name against
 * every transition. `receivedByUserId` and `returnedByUserId` are the
 * columns that matter -- not for blame, but so that "who took the ring in?"
 * has an answer at all.
 */
export const caseBelongingsTable = pgTable(
  "case_belongings",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    kind: text("kind").notNull().default("other"),

    /** "Navy suit, white shirt, burgundy tie". As the family described it. */
    description: text("description").notNull(),

    /**
     * Whether it stays with them or comes back.
     *
     * `undecided` is a real state and the default for jewellery, because it
     * is the decision families most often want to sleep on -- and forcing a
     * choice at intake is how a ring ends up buried that a granddaughter was
     * expecting to inherit.
     */
    disposition: text("disposition").notNull().default("undecided"),

    /** Where the item physically is. */
    status: text("status").notNull().default("expected"),

    /** A photograph of the item. Worth far more than a description for
     * jewellery, where "gold ring" describes a thousand different rings. */
    photoUploadId: integer("photo_upload_id"),

    receivedAt: timestamp("received_at"),
    receivedByUserId: integer("received_by_user_id"),
    /** Who handed it over, when that was a family member rather than post. */
    receivedFromContactId: integer("received_from_contact_id"),

    returnedAt: timestamp("returned_at"),
    returnedByUserId: integer("returned_by_user_id"),
    returnedToContactId: integer("returned_to_contact_id"),
    /** Typed by the person collecting it. Not a signature, and not pretending
     * to be one — a name and a timestamp is what a paper form gives too. */
    returnedToName: text("returned_to_name"),

    notes: text("notes"),
    position: integer("position").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("case_belongings_case_idx").on(table.caseId, table.position),
    index("case_belongings_home_idx").on(table.funeralHomeId),
  ],
);

export const BELONGING_KINDS = [
  "clothing",
  "undergarments",
  "shoes",
  "jewellery",
  "glasses",
  "dentures",
  "keepsake",
  "photograph",
  "other",
] as const;
export type BelongingKind = (typeof BELONGING_KINDS)[number];

/** `expected` -> `received` -> (`with_deceased` | `returned`). */
export const BELONGING_STATUSES = [
  "expected",
  "received",
  "with_deceased",
  "returned",
] as const;
export type BelongingStatus = (typeof BELONGING_STATUSES)[number];

export const BELONGING_DISPOSITIONS = [
  "undecided",
  "with_deceased",
  "return_to_family",
] as const;
export type BelongingDisposition = (typeof BELONGING_DISPOSITIONS)[number];

/**
 * The standard list a home asks every family for.
 *
 * Written as prompts rather than as a form, because "undergarments" is a
 * question nobody wants to be asked and everybody forgets to answer. Having
 * it on a list the family reads at home, in their own time, is kinder than
 * having a director raise it across a desk.
 */
export const DEFAULT_BELONGING_PROMPTS: ReadonlyArray<{
  kind: BelongingKind;
  description: string;
  disposition: BelongingDisposition;
}> = [
  { kind: "clothing", description: "Outer clothing", disposition: "with_deceased" },
  { kind: "undergarments", description: "Undergarments", disposition: "with_deceased" },
  { kind: "shoes", description: "Shoes or slippers", disposition: "with_deceased" },
  { kind: "glasses", description: "Glasses", disposition: "undecided" },
  { kind: "jewellery", description: "Jewellery — rings, watch, necklace", disposition: "undecided" },
];

export const insertBelongingSchema = createInsertSchema(
  caseBelongingsTable,
).omit({ id: true, funeralHomeId: true, caseId: true, createdAt: true, updatedAt: true });
export type InsertBelonging = z.infer<typeof insertBelongingSchema>;
export type CaseBelonging = typeof caseBelongingsTable.$inferSelect;

/**
 * The preparation sheet: how they should look.
 *
 * One row per case. Separate from `cases` because this is the one part of the
 * record that goes to the preparation room rather than to the family, and
 * keeping it in its own table makes "what did the family actually ask for"
 * answerable in a single read.
 *
 * Every field is free text and nothing is required. A family who says only
 * "she never wore makeup" has told the cosmetician the most important thing
 * there is to know, and a form that demanded a foundation shade would have
 * lost it.
 */
export const casePreparationTable = pgTable(
  "case_preparation",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /** "Parted on the left. She set it herself every Friday." */
    hairNotes: text("hair_notes"),
    /** "Very light. Never wore foundation. A little pink lipstick." */
    cosmeticsNotes: text("cosmetics_notes"),
    nailNotes: text("nail_notes"),

    /** Small, specific, and the sort of thing families lie awake about. */
    glassesWorn: boolean("glasses_worn"),
    dentures: boolean("dentures"),

    /** "Her wedding ring, left hand. The watch stays with my brother." */
    jewelleryNotes: text("jewellery_notes"),

    /** Anything else: scars to leave, a scarf she always wore, a hearing aid. */
    otherNotes: text("other_notes"),

    /** Set when staff have read it, so nothing goes to the room unseen. */
    reviewedAt: timestamp("reviewed_at"),
    reviewedByUserId: integer("reviewed_by_user_id"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("case_preparation_case_unique").on(table.caseId)],
);

export type CasePreparation = typeof casePreparationTable.$inferSelect;

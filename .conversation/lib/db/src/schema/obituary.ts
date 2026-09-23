import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";

/**
 * The obituary, built from fields rather than typed into a blank box.
 *
 * The problem this solves is not writing. It is that obituary copy currently
 * reaches directors as text-message fragments at two in the morning — a list
 * of grandchildren in one, a correction to a middle name in another, the name
 * of the church in a third — and somebody at the home has to assemble that
 * into printable prose without misspelling anyone.
 *
 * So the family fills in named fields, and the server composes a draft from
 * them. The fields stay authoritative: a corrected grandchild's name is one
 * edit, not a rewrite. `draftText` is the composed version, and once a
 * director touches it, `draftEditedByStaff` records that regenerating would
 * throw their work away.
 *
 * One row per case, enforced by the unique index. A second obituary is
 * always a mistake.
 */
export const obituaryDraftsTable = pgTable(
  "obituary_drafts",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /* ------------------------------------------------------- the fields */

    fullName: text("full_name"),
    /** Free text, not a date. Families write "spring of 1931". */
    bornOn: text("born_on"),
    birthPlace: text("birth_place"),
    diedOn: text("died_on"),
    deathPlace: text("death_place"),

    /** "Her husband of 54 years, Ron; her daughters Anne and Judith; ..." */
    survivedBy: text("survived_by"),
    /** "Preceded in death by her son, Michael." */
    precededBy: text("preceded_by"),

    /** The life: work, service, what they loved. The long field. */
    biography: text("biography"),
    /** "In lieu of flowers, donations to ..." */
    inLieuOfFlowers: text("in_lieu_of_flowers"),
    specialThanks: text("special_thanks"),

    /* -------------------------------------------------------- the draft */

    draftText: text("draft_text"),
    /**
     * Set once staff have edited the composed text by hand. After that the
     * server will not silently recompose over their edit — it offers, and
     * the director decides.
     */
    draftEditedByStaff: timestamp("draft_edited_by_staff"),

    /**
     * `family_draft` — the family is still filling it in.
     * `submitted`    — they have said they are done; it is the director's.
     * `approved`     — the director has signed it off for print.
     */
    status: text("status").notNull().default("family_draft"),
    submittedAt: timestamp("submitted_at"),
    approvedAt: timestamp("approved_at"),
    approvedByUserId: integer("approved_by_user_id"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("obituary_drafts_case_id_unique").on(table.caseId)],
);

export const OBITUARY_STATUSES = [
  "family_draft",
  "submitted",
  "approved",
] as const;
export type ObituaryStatus = (typeof OBITUARY_STATUSES)[number];

export const insertObituaryDraftSchema = createInsertSchema(
  obituaryDraftsTable,
).omit({
  id: true,
  funeralHomeId: true,
  caseId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertObituaryDraft = z.infer<typeof insertObituaryDraftSchema>;
export type ObituaryDraft = typeof obituaryDraftsTable.$inferSelect;

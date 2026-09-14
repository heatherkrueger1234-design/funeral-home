import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";
import { uploadsTable } from "./uploads";
import type { SealedEnvelope } from "../sealed";

/**
 * What somebody leaves behind on purpose.
 *
 * A pre-need case is already a `cases` row with `kind = 'pre_need'`; this file
 * adds the three things that only exist because the person was alive to make
 * them, and that no amount of paperwork replaces.
 *
 *  - **Recordings.** Two minutes of somebody talking is worth more than every
 *    other row in this database. It is also the only thing here that cannot
 *    be reconstructed afterwards by anybody, at any price.
 *  - **Open letters.** Written to whoever opens the file. These are the "don't
 *    wear black" and "the deed is in the green folder" notes, and they stop
 *    arguments before they start.
 *  - **Sealed notes.** One named reader each, and unreadable by this company,
 *    by the funeral home, and by anybody holding the database. See `sealed.ts`,
 *    which is where the actual promise is kept.
 *
 * All three are held from the moment they are written until the home records
 * the death. `releasedAt` on the case is what opens them, and nothing else
 * does — there is no support route and no override, which is the same rule
 * the rest of this product applies to a family link.
 */

export const PRENEED_MEDIA_KINDS = ["video", "audio", "letter"] as const;
export type PreNeedMediaKind = (typeof PRENEED_MEDIA_KINDS)[number];

export const preNeedMediaTable = pgTable(
  "pre_need_media",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    kind: text("kind").notNull().default("video"),

    title: text("title").notNull(),

    /**
     * Who it is addressed to, as they wrote it: "Everyone", "Ruth", "The
     * grandchildren". Free text and not a foreign key on purpose — a person
     * writing this is naming people, not selecting records, and half of them
     * are not in the system at all.
     *
     * This is a label, not a lock. Anybody who opens the file reads it. The
     * thing that is actually restricted to one person is a sealed note.
     */
    forWhom: text("for_whom").notNull().default("Everyone"),

    /** For a letter. Encrypted at rest, like every other long-form column. */
    body: text("body"),

    /** For a recording. */
    uploadId: integer("upload_id").references(() => uploadsTable.id, {
      onDelete: "set null",
    }),
    durationSeconds: integer("duration_seconds"),

    /**
     * What they said, for somebody who cannot watch it.
     *
     * A grandchild who is deaf, a relative on a train, somebody who wants to
     * find the bit about the house without scrubbing through eleven minutes.
     * Optional, because the recording matters more than the transcript.
     */
    transcript: text("transcript"),

    position: integer("position").notNull().default(0),

    /** When it was recorded or written, which is the date the family sees. */
    writtenAt: timestamp("written_at").notNull().defaultNow(),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("pre_need_media_case_idx").on(table.caseId, table.position),
  ],
);

/**
 * A note for one person, locked with a passcode nobody here has.
 *
 * The columns are chosen so that this table can be read in full — by a
 * support engineer, by a restored backup, by a subpoena — without revealing
 * one word of what anybody wrote. What is stored is who it is for, when it
 * was sealed, whether the envelope has been handed over, and a blob that is
 * useless without a passcode this database has never held.
 *
 * Read `sealed.ts` before changing anything here. In particular: there is no
 * passcode column, and adding one is not a feature, it is the end of the
 * feature. The one sanctioned exception is `escrowedPasscode`, which exists
 * because a planner may decide a director reading the code off a screen is
 * good enough for what *they* wrote — it is off unless they turn it on, and
 * the column is named so that nobody can use it by accident.
 */
export const sealedNotesTable = pgTable(
  "sealed_notes",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /** Whose envelope this is. Printed on the card; the handover depends on it. */
    forWhom: text("for_whom").notNull(),
    relationship: text("relationship"),

    /**
     * A line the writer leaves in the open, to help the right person
     * remember: "the town we broke down in, 1987".
     *
     * Guidance in the UI steers people to a shared memory rather than a fact,
     * because a mother's maiden name, a birthday and a pet's name are all in
     * somebody's social media and a shared embarrassment is not. Optional:
     * with the card in hand nobody needs it.
     */
    hint: text("hint"),

    /**
     * The sealed thing. `SealedEnvelope` from `sealed.ts` — version, scrypt
     * parameters, salt, iv, tag, ciphertext, verifier. No passcode.
     */
    envelope: jsonb("envelope").notNull().$type<SealedEnvelope>(),

    /**
     * The passcode, encrypted under the application key, *only* when the
     * writer chose to let the home read it out.
     *
     * Null is the default and the right answer. When it is set, this note has
     * the security of a password in the office safe rather than the security
     * described at the top of `sealed.ts`, and the planner was told so in one
     * sentence before they chose it.
     */
    escrowedPasscode: text("escrowed_passcode"),

    /** Whether the card has been printed. A second print is a second copy. */
    cardPrintedAt: timestamp("card_printed_at"),

    /**
     * When a director recorded handing the sealed envelope over, and to whom
     * they handed it.
     *
     * Not a permission — the note does not open because of this and does not
     * stay shut without it. It is a custody record, which is the thing a home
     * will be asked about if an envelope goes to the wrong sibling, and the
     * reason to keep it is the same reason `case_belongings` exists.
     */
    handedOverAt: timestamp("handed_over_at"),
    handedOverTo: text("handed_over_to"),

    /**
     * Failed attempts, counted so the API can slow them down.
     *
     * Forty bits behind scrypt is not brute-forceable offline in any useful
     * time, but this endpoint is reachable by anyone holding a family link,
     * and a person who is *certain* they know which word it should be will
     * happily sit there trying forty of them.
     */
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at"),

    openedAt: timestamp("opened_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("sealed_notes_case_idx").on(table.caseId),
  ],
);

/**
 * The rest of what a person decides in advance and nobody else can guess.
 *
 * One row per pre-need case. Everything here is the kind of thing a family
 * spends an afternoon arguing about because the only person who knew is the
 * one they are arguing over.
 */
export const preNeedWishesTable = pgTable(
  "pre_need_wishes",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /** Burial, cremation, donation — and what they want done with either. */
    disposition: text("disposition"),

    /** Set when they took one of the home's plots. */
    plotId: integer("plot_id"),

    /** Or made their own arrangements, described in their own words. */
    ownArrangements: text("own_arrangements"),

    /** Who is allowed to change any of this while they are alive. */
    agentName: text("agent_name"),
    agentRelationship: text("agent_relationship"),
    agentPhone: text("agent_phone"),

    /**
     * Whether the home may show the family what was pre-paid.
     *
     * Off by default. A planner frequently does not want their children to
     * know what any of it cost, and a product that discloses it by default
     * has made that decision for them.
     */
    showPricesToFamily: boolean("show_prices_to_family").notNull().default(false),

    /** When they last touched it. People revise these for years. */
    reviewedAt: timestamp("reviewed_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("pre_need_wishes_case_idx").on(table.caseId),
  ],
);

/* ------------------------------------------------------------- contracts -- */

export const insertPreNeedMediaSchema = createInsertSchema(preNeedMediaTable)
  .omit({ id: true, funeralHomeId: true, caseId: true, createdAt: true, updatedAt: true })
  .extend({ kind: z.enum(PRENEED_MEDIA_KINDS) });
export type InsertPreNeedMedia = z.infer<typeof insertPreNeedMediaSchema>;
export type PreNeedMedia = typeof preNeedMediaTable.$inferSelect;

export type SealedNote = typeof sealedNotesTable.$inferSelect;
export type PreNeedWishes = typeof preNeedWishesTable.$inferSelect;

/**
 * How a sealed note is described to anybody who is not holding the passcode
 * — which is everybody, including the funeral home and including us.
 *
 * Exists so that no route has to remember which columns are safe to return.
 * If a field is not in here, it does not leave the server.
 */
export function toSealedNoteSummary(note: SealedNote) {
  return {
    id: note.id,
    forWhom: note.forWhom,
    relationship: note.relationship,
    hint: note.hint,
    sealedAt: note.createdAt,
    cardPrintedAt: note.cardPrintedAt,
    handedOverAt: note.handedOverAt,
    handedOverTo: note.handedOverTo,
    openedAt: note.openedAt,
    /** True when a director can read the passcode out. Shown to the reader
     *  too, because "who else could have opened this" is a fair question. */
    homeCanReveal: note.escrowedPasscode !== null,
  };
}

/**
 * How long to make somebody wait after a wrong passcode.
 *
 * Doubling, capped at a minute. The shape is chosen for the person who is
 * genuinely mistyping — the first two mistakes cost nothing anybody notices —
 * while a sibling working through everything they can think of runs into a
 * wall quickly enough to give up before they get anywhere.
 */
export function retryDelayMs(failedAttempts: number): number {
  if (failedAttempts < 3) return 0;
  return Math.min(60_000, 1000 * Math.pow(2, failedAttempts - 3));
}

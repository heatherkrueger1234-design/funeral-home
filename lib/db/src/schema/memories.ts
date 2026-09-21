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
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";

/**
 * The memory book: what the family has to show for the year afterwards.
 *
 * The aftercare check-ins are the best thing this product does and the
 * hardest to point at. A home that sends them has nothing to show a family
 * at the end of it, and nothing to show the *next* family either — "we stay
 * in touch" is a claim every home makes. A book is the thing you can put on
 * a table at an arrangement conference.
 *
 * So the year is not just four emails, it is a collection period. Each
 * check-in asks whether anything has come back to them — the way she
 * answered the phone, what he was like at Christmas — and what accumulates
 * is a book with the photographs already in it, because the photographs are
 * already in here from the funeral.
 *
 * Two things follow from this being *the family's* book, and both are load
 * bearing:
 *
 *   - **It is free to them, for ever.** It is assembled out of photographs
 *     they uploaded of their own mother and words they wrote themselves.
 *     `plans.ts` sets out at length why a keepsake fee is the one revenue
 *     line this product refuses, and `no-family-charges.test.ts` fails the
 *     build if the book ever grows one.
 *   - **It is erased with the case.** Unlike `billable_cases`, which is an
 *     accounting record carrying no name and deliberately outlives erasure,
 *     everything here is family content about a named person. The cascade
 *     below is the whole mechanism -- `POST /cases/:id/delete` drops the
 *     case row and lets the database take the rest.
 */

/**
 * One book per case. Created the first time anybody looks at it rather than
 * with the case, because most of its fields are things somebody chose, and
 * a table full of empty default books tells you nothing about which cases
 * anyone is actually keeping one for.
 */
export const memoryBooksTable = pgTable(
  "memory_books",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /** Defaults to "Remembering <name>" at render time when blank. */
    title: text("title"),

    /**
     * A line or two on the page after the cover, in the family's words.
     * "For Dad, who would have hated the fuss." Optional, and much better
     * than anything this software could write for them.
     */
    dedication: text("dedication"),

    /**
     * When contributions stop. Null means open, which is the default and
     * the right one: there is no date on which a family should be told they
     * are too late to remember something.
     *
     * A home can set it when they are about to have the book printed, which
     * is the only reason the column exists. Closing does not hide the book
     * or stop anybody reading or printing it; it stops new entries.
     */
    closesAt: timestamp("closes_at"),

    /**
     * Whether the photographs chosen for the slideshow go in the book.
     *
     * On by default: they are already chosen, already in order, and already
     * the ones the family wanted people to see. A home that is printing a
     * words-only booklet turns it off.
     */
    includePhotos: boolean("include_photos").notNull().default(true),

    /**
     * Whether the obituary is printed after the dedication. On by default
     * for the same reason -- it exists, it is approved, and it is the piece
     * of writing that says who the person was.
     */
    includeObituary: boolean("include_obituary").notNull().default(true),

    /**
     * The rest of the sections, each one a switch.
     *
     * All on by default, because a section with nothing in it prints
     * nothing at all -- the renderer skips an empty one rather than
     * printing a heading over a blank page. So the default costs a home
     * that is not using a section precisely nothing, and a home that wants
     * a plain photograph album can still turn the life story off and have
     * one.
     */
    includeLifeStory: boolean("include_life_story").notNull().default(true),
    includeCelebration: boolean("include_celebration").notNull().default(true),
    includeEulogies: boolean("include_eulogies").notNull().default(true),
    /** Photographs taken at the funeral, printed at the back with the day. */
    includeServicePhotos: boolean("include_service_photos")
      .notNull()
      .default(true),

    /* -------------------------------------------- the day itself ------- */

    /*
     * The celebration of life, as a page in the book.
     *
     * When and where are already on the case and are not duplicated here.
     * What is here is everything a case does not model, and the field names
     * follow the print templates' slots on purpose -- a director filling in
     * an order of service for the printed program should recognise these.
     *
     * All free text, all optional, and all printed only if somebody typed
     * something. A structured model of a funeral service -- hymns as rows,
     * readings as rows -- was considered and is the wrong shape: the point
     * of this page is that thirty years from now a grandchild can read what
     * happened that day, and "Amazing Grace, sung by the grandchildren" is
     * a better record of it than three normalised tables.
     */
    serviceOrder: text("service_order"),
    music: text("music"),
    bearers: text("bearers"),
    reception: text("reception"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("memory_books_case_unique").on(table.caseId),
    index("memory_books_home_idx").on(table.funeralHomeId),
  ],
);

export type MemoryBook = typeof memoryBooksTable.$inferSelect;

/**
 * One memory. A paragraph, optionally a photograph, optionally a when.
 *
 * `whenText` is free text and not a date, and that is the single most
 * important decision in this table. A memory's date is almost never a date:
 * it is "the summer we had the caravan", "every Sunday for about nine
 * years", "Christmas, some time in the eighties". A date picker here would
 * make people either lie or give up, and giving up is what actually happens.
 */
export const memoryEntriesTable = pgTable(
  "memory_entries",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /**
     * Who wrote it, snapshotted rather than joined.
     *
     * The same reasoning as `aftercare_enrollments.brandedAs`: this is the
     * name that gets printed under the paragraph in a book somebody will
     * keep, and it must not change because a director tidied up a contact
     * record eight months later. A grandchild who signed "Katie" should not
     * become "Katherine Hale (granddaughter)" in print.
     */
    authorName: text("author_name").notNull(),

    /** `family` or `staff`. Printed differently; see the renderer. */
    authorSide: text("author_side").notNull().default("family"),

    /**
     * `memory` -- a paragraph somebody remembered.
     * `eulogy`  -- what somebody stood up and read at the service.
     *
     * The same table because they are the same shape: a piece of writing,
     * attributed to a named person, optionally with a photograph. What
     * differs is length and where they print -- a eulogy runs to a
     * thousand words and belongs with the day, a memory runs to a
     * paragraph and belongs with the others. Two tables to express that
     * would have been two of everything else as well.
     */
    kind: text("kind").notNull().default("memory"),

    /** Which family link wrote it, where one did. Null for staff entries. */
    authorContactId: integer("author_contact_id"),
    /** Which staff member wrote it. Null for family entries. */
    authorUserId: integer("author_user_id"),

    body: text("body").notNull(),

    /** "Christmas 1986". Free text on purpose -- see above. */
    whenText: text("when_text"),

    /**
     * A photograph from the case's own bin, by `case_photos.id`.
     *
     * Deliberately a reference to a photograph already uploaded rather than
     * a second upload path. There is one place photographs of this person
     * live, one encryption path and one erase path, and a memory book that
     * quietly created a second one would be a second thing to get wrong on
     * the day a family asks for everything to be destroyed.
     */
    photoId: integer("photo_id"),

    /**
     * Whether it goes in the printed book.
     *
     * Families are complicated, and a memory book is exactly where that
     * surfaces: an estranged relative writing something barbed into a
     * widow's keepsake is a real thing that will happen. The home can take
     * an entry out of the book without deleting it, because deleting it
     * silently is its own problem when somebody asks why theirs is missing.
     */
    includedInBook: boolean("included_in_book").notNull().default(true),
    /** Who took it out, and when. Empty in the ordinary case. */
    excludedAt: timestamp("excluded_at"),
    excludedReason: text("excluded_reason"),

    /** Order in the book. Ties break on id, which is order of arrival. */
    position: integer("position").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("memory_entries_case_idx").on(table.caseId, table.position),
    index("memory_entries_home_idx").on(table.funeralHomeId),
    index("memory_entries_author_idx").on(table.authorContactId),
  ],
);

export type MemoryEntry = typeof memoryEntriesTable.$inferSelect;

export const MEMORY_AUTHOR_SIDES = ["family", "staff"] as const;
export type MemoryAuthorSide = (typeof MEMORY_AUTHOR_SIDES)[number];

export const MEMORY_KINDS = ["memory", "eulogy"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/**
 * Roughly a page of typing.
 *
 * Long enough for the story about the caravan, short enough that the book
 * stays a book. Not enforced as a hard truncation anywhere -- the API
 * refuses the write and says so, rather than silently keeping the first
 * half of somebody's paragraph about their mother.
 */
export const MEMORY_MAX_LENGTH = 4000;

/**
 * And a eulogy, which is a different thing at a different length.
 *
 * A spoken eulogy runs eight to twelve minutes, which is fifteen hundred
 * words, which is about ten thousand characters with the pauses typed in as
 * paragraph breaks. Twenty thousand leaves room for the long one somebody's
 * brother wrote and read every word of, and is still short of the length at
 * which this stops being a eulogy and starts being a manuscript.
 */
export const EULOGY_MAX_LENGTH = 20000;

/** A chapter of a life. Long enough for a decade, short enough to read. */
export const LIFE_CHAPTER_MAX_LENGTH = 6000;

/**
 * How many photographs a single rendered book will embed.
 *
 * The book is one self-contained HTML file with the pictures inside it, so
 * this is the number that decides whether a family can open the thing. A
 * hundred downscaled photographs is already a large file; four hundred --
 * which is a perfectly ordinary bin for a long life -- would be unopenable.
 * The selection is used first, which is already the curated set.
 */
export const MEMORY_BOOK_MAX_PHOTOS = 60;

/**
 * And the total weight of those photographs, which is the limit that
 * actually bites.
 *
 * A count is not enough on its own: photographs out of a real bin run from
 * 40KB to 4MB, so "sixty of them" is either a two-megabyte file or a
 * two-hundred-megabyte one. What decides whether a grieving family can
 * open their own book is the total. Twenty-four megabytes is a large but
 * survivable download and prints to a PDF a shop will accept.
 */
export const MEMORY_BOOK_IMAGE_BUDGET_BYTES = 24 * 1024 * 1024;

/* ---------------------------------------------------------- a whole life -- */

/**
 * The life story: what happened, in the order it happened.
 *
 * Separate from `memory_entries` because they are genuinely different
 * things, and collapsing them would have made both worse. A memory is *I
 * remember this about her* — it is one person's, it is attributed, and it
 * belongs next to the other memories in whatever order they arrived. A
 * chapter is *this is what happened* — it is the family's collectively, it
 * belongs in the year it happened, and nobody signs it in the book.
 *
 * What this is for is the thing a family says they will do and never does:
 * write down where she was born, what the house on Cedar Street was like,
 * which year they moved, what he did in the war, why they stopped keeping
 * bees. An obituary is four hundred words agreed by committee under
 * deadline. This has a year to fill and as many hands as want to fill it.
 *
 * Ordering is by `startYear` first and `position` only as a tiebreak,
 * which is the opposite of everywhere else in this schema. A life story
 * assembled by six relatives over nine months arrives in no order at all,
 * and the one thing everybody already agrees on is which decade a thing
 * happened in. Undated chapters sort to the end rather than to the front:
 * an unplaced note about the bees is a footnote, not a prologue.
 */
export const lifeChaptersTable = pgTable(
  "life_chapters",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /** "The Pueblo years", "Married", "Riverside Elementary". Optional. */
    title: text("title"),
    /** The prose. Optional too -- a milestone is a title and a year. */
    body: text("body"),

    /**
     * Years, not dates, for the same reason `case_photos.takenYear` is a
     * year: a family knows the decade and argues about the month.
     * `endYear` is for a span -- "1961–1990, Riverside Elementary" -- and
     * is null for a moment.
     */
    startYear: integer("start_year"),
    endYear: integer("end_year"),

    /** A photograph from this case's own bin. Same rule as a memory's. */
    photoId: integer("photo_id"),

    /**
     * Who added it. Recorded but **not printed** — see the renderer.
     *
     * The life story reads as the family's, in one voice, because that is
     * what it is; a chapter about somebody's birth signed by whichever
     * cousin happened to type it would be strange. The attribution is kept
     * anyway, because a director asked "who wrote this, it is wrong" needs
     * an answer.
     */
    authorName: text("author_name").notNull(),
    authorSide: text("author_side").notNull().default("family"),
    authorContactId: integer("author_contact_id"),
    authorUserId: integer("author_user_id"),

    /** Same curation as a memory, and for the same reasons. */
    includedInBook: boolean("included_in_book").notNull().default(true),
    excludedAt: timestamp("excluded_at"),
    excludedReason: text("excluded_reason"),

    /** Only a tiebreak within a year, and a way to order undated ones. */
    position: integer("position").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("life_chapters_case_idx").on(
      table.caseId,
      table.startYear,
      table.position,
    ),
    index("life_chapters_home_idx").on(table.funeralHomeId),
  ],
);

export type LifeChapter = typeof lifeChaptersTable.$inferSelect;

/**
 * Somebody's age in a given year, or null when it cannot be worked out.
 *
 * Deliberately coarse: year minus year, with no birthday arithmetic. The
 * input is a year, so the answer is only ever right to within one, and a
 * caption that says "aged 36" under a photograph taken the week before her
 * thirty-seventh birthday is exactly what a family would have written
 * themselves. Presenting it to the day would be false precision built on a
 * number nobody measured.
 *
 * Null before birth and past about 120, because a wrong `takenYear` typed
 * as 1074 should print nothing rather than "aged 964".
 */
export function ageInYear(
  dateOfBirth: Date | null,
  takenYear: number | null,
): number | null {
  if (dateOfBirth === null || takenYear === null) return null;

  const age = takenYear - dateOfBirth.getUTCFullYear();
  if (age < 0 || age > 120) return null;

  return age;
}

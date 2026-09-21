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
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";

/**
 * The printed things a funeral produces, and how they get made.
 *
 * What a home currently does: opens Publisher or a Word template somebody
 * made in 2014, retypes the name and dates, drags a photograph in, prints a
 * test sheet, discovers the bleed is wrong, and does it again. Often at nine
 * at night, for a service at eleven the next morning.
 *
 * What this does instead: the layouts are ready, the case already knows the
 * name, the dates, the portrait and the service details, and the family has
 * already chosen a photograph. Pick a template, pick the text, print.
 *
 * The deliberate omission is a general-purpose design tool. Drag-and-drop
 * canvases are how you end up with a prayer card where the name is 3px off
 * the fold and nobody notices until two hundred are printed. The templates
 * are fixed layouts with named slots; what a director chooses is *which*
 * template and *what goes in the slots*, never where things sit.
 */

/**
 * A print item on a case: which template, and what was put in it.
 *
 * `values` is JSON because the slots differ per template and this is
 * presentation, not data anybody queries. The facts that matter — the
 * decedent's name, the dates, the portrait — live on the case and are filled
 * in automatically; `values` holds only what a human chose or typed for this
 * particular piece.
 */
export const casePrintItemsTable = pgTable(
  "case_print_items",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /** Which layout. Matches a key in `PRINT_TEMPLATES`. */
    templateKey: text("template_key").notNull(),

    /** "Prayer cards for the family" — so two of the same kind are tellable. */
    title: text("title"),

    /**
     * The photograph for this piece. Defaults to the case portrait, but a
     * bookmark and an order of service often want different pictures.
     */
    photoId: integer("photo_id"),

    /** Slot contents: `{ verse: "...", closing: "..." }`. */
    values: jsonb("values").notNull().default({}),

    /**
     * How many to print. Recorded because it is the number a director rings
     * the printer with, and because "we did 150 last time" is genuinely
     * useful when the same family buries a second parent.
     */
    quantity: integer("quantity"),

    /**
     * `draft` — being put together.
     * `proof` — sent to the family to check.
     * `approved` — signed off; the family can no longer change it.
     *
     * The proof step exists because the single most common reprint is a
     * misspelled name, and the only person who reliably catches that is the
     * family.
     */
    status: text("status").notNull().default("draft"),
    approvedAt: timestamp("approved_at"),
    approvedByUserId: integer("approved_by_user_id"),

    /** Whether the family may see and comment on this one yet. */
    sharedWithFamily: boolean("shared_with_family").notNull().default(false),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("case_print_items_case_idx").on(table.caseId),
    index("case_print_items_home_idx").on(table.funeralHomeId),
  ],
);

export const PRINT_STATUSES = ["draft", "proof", "approved"] as const;
export type PrintStatus = (typeof PRINT_STATUSES)[number];

export type CasePrintItem = typeof casePrintItemsTable.$inferSelect;

/**
 * The home's own snippets: verses, prayers, closing lines, poems.
 *
 * Deliberately **not** seeded with text. Two reasons, and both matter.
 *
 * The legal one: most of what gets printed on a prayer card is somebody's
 * copyright. A handful of things are genuinely public domain, but a great
 * deal of what families actually ask for is not, and a product that ships
 * two hundred verses to two hundred funeral homes is publishing them.
 *
 * The better one: a home already has these. They are in a Word file called
 * `verses.doc` that every director copies from, and they reflect that home's
 * community — its denominations, its languages, the three readings the local
 * priest always uses. A generic list would be worse than the one they have.
 *
 * So this is a place to put that file, once, so it stops being copied and
 * pasted. Homes own what they add and are responsible for having the right
 * to print it, which is the same position they are in today.
 */
export const snippetsTable = pgTable(
  "snippets",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /** Where it tends to go: a card verse, a closing line, a full reading. */
    kind: text("kind").notNull().default("verse"),

    /** What a director scans for: "23rd Psalm", "Footprints", "Irish blessing". */
    title: text("title").notNull(),
    body: text("body").notNull(),
    attribution: text("attribution"),

    /** Marked by the home when they know it is theirs to print. */
    clearedForPrint: boolean("cleared_for_print").notNull().default(false),

    /** Ordering, so the three they always use sit at the top. */
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("snippets_home_idx").on(
      table.funeralHomeId,
      table.kind,
      table.position,
    ),
  ],
);

export const SNIPPET_KINDS = [
  "verse",
  "prayer",
  "poem",
  "reading",
  "closing",
  "hymn",
] as const;
export type SnippetKind = (typeof SNIPPET_KINDS)[number];

export type Snippet = typeof snippetsTable.$inferSelect;

export const snippetInputSchema = z.object({
  kind: z.enum(SNIPPET_KINDS).optional(),
  title: z.string().min(1),
  body: z.string().min(1),
  attribution: z.string().nullable().optional(),
  clearedForPrint: z.boolean().optional(),
});

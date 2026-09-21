import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";

/**
 * The things people say about somebody, before and after the service.
 *
 * This table exists because of a gap between two screens that already work.
 * The obituary is a form of named fields, which is right — it turns "write
 * the obituary" into eight answerable questions. But the fields it asks for
 * are facts: dates, places, who survives whom. The one field that is not a
 * fact, `biography`, is a single box labelled "their life", and a single box
 * is the thing the whole form exists to avoid.
 *
 * Meanwhile the minister taking the service has often never met the person.
 * What they get today is a telephone call the day before, in which a director
 * reads out what they can remember of what the family said. Everything good
 * in a eulogy — that she swore at the television during the racing, that he
 * kept every one of his children's school reports in a biscuit tin — reaches
 * the pulpit by word of mouth or does not reach it at all.
 *
 * Both problems are the same missing thing: somewhere to put a small specific
 * story at the moment somebody remembers it. So:
 *
 *  - A family adds them a few sentences at a time, against a prompt, from
 *    whoever's phone is nearest, over a week.
 *  - The `prompt` is stored **on the row** rather than referenced by id, so a
 *    memory stays self-describing for as long as the case exists even if the
 *    list of questions is rewritten next year. It costs a text column and it
 *    buys never having to migrate somebody's mother's story.
 *  - `forOfficiant` is what the family (or the director) ticks to say "this
 *    one is for the minister". Consent, not a flag: the rest stay private to
 *    the case, and a family that writes something only for themselves is not
 *    handing it to a stranger to read aloud.
 *
 * And `kind` carries the other half, which is what the service produced
 * rather than what went into it. A eulogy given at a graveside currently
 * survives only if a relative happened to keep the sheet of paper. A row of
 * `kind: "tribute"` is the same story pointed the other way through time --
 * the thing families ring up asking for, months later, when they are making
 * the book.
 */
export const caseMemoriesTable = pgTable(
  "case_memories",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /**
     * `memory`  — written beforehand, by the family, about the person.
     * `tribute` — what was actually said at the service, kept afterwards.
     */
    kind: text("kind").notNull().default("memory"),

    /**
     * The question this answers, in the words it was asked in — "What were
     * they like when you were small?". Null for anything written freehand,
     * and for tributes, which answer nothing.
     */
    prompt: text("prompt"),

    body: text("body").notNull(),

    /**
     * Who this came from, and exactly one of these three is set.
     *
     * `authorName` is the odd one out and the necessary one: the person who
     * gave the eulogy has no account here and never will, and "Rev. James
     * Okafor" or "her brother Tom" is the only record that will ever exist of
     * who said it.
     */
    authorContactId: integer("author_contact_id"),
    authorUserId: integer("author_user_id"),
    authorName: text("author_name"),

    /** Ticked to put it on the sheet the minister is handed. */
    forOfficiant: boolean("for_officiant").notNull().default(false),

    position: integer("position").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("case_memories_case_idx").on(table.caseId, table.kind, table.position),
    index("case_memories_home_idx").on(table.funeralHomeId),
  ],
);

export const MEMORY_KINDS = ["memory", "tribute"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type CaseMemory = typeof caseMemoriesTable.$inferSelect;

/**
 * Long enough for a proper story, short enough that nobody is writing the
 * eulogy itself into a box with no formatting. A tribute is the exception --
 * a whole homily pasted in afterwards is the point of it — so the ceiling is
 * generous rather than tight.
 */
export const MEMORY_MAX_LENGTH = 4000;

export const memoryInputSchema = z.object({
  kind: z.enum(MEMORY_KINDS).optional(),
  prompt: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(MEMORY_MAX_LENGTH),
  authorName: z.string().max(120).nullable().optional(),
  forOfficiant: z.boolean().optional(),
});

export const memoryUpdateSchema = z.object({
  body: z.string().min(1).max(MEMORY_MAX_LENGTH).optional(),
  authorName: z.string().max(120).nullable().optional(),
  forOfficiant: z.boolean().optional(),
});

import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { funeralHomesTable } from "./funeral-homes";

/**
 * The things a home says the same way every time, written down once.
 *
 * Every director has eight or nine of these: what a deposit is and when it
 * is due, how long the family has to bring clothing, whether children come
 * to a viewing, what happens if the weather closes the cemetery road. They
 * currently live in a laminated sheet, a Word file from 2015, and the
 * director's memory, which means each family gets a slightly different
 * version and nobody can point at the one that was said.
 *
 * Sections rather than one long field, because a grieving person reads
 * headings and stops. Published rather than deleted, because a home will
 * want to draft the awkward one -- the money one -- before anybody outside
 * the office sees it.
 *
 * These are words, not behaviour. Nothing here changes what the software
 * does; a home that writes "photographs are due four days before" here and
 * does not also move the standard schedule has changed a sentence and not a
 * date, and the storefront editor says so out loud. The rules that genuinely
 * change what the software does are columns on `funeral_homes`, next to the
 * office hours, where their effects are visible.
 */
export const homePoliciesTable = pgTable(
  "home_policies",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /** "Deposits and payment", "Bringing clothing in". A heading, not a sentence. */
    title: text("title").notNull(),
    body: text("body").notNull(),

    position: integer("position").notNull().default(0),

    /**
     * Off means it is a draft: staff see it, the public page and the family
     * portal do not. New sections start off, because the first draft of the
     * paragraph about money is never the one to put on the internet.
     */
    published: boolean("published").notNull().default(false),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("home_policies_home_idx").on(table.funeralHomeId, table.position),
  ],
);

export const insertHomePolicySchema = createInsertSchema(
  homePoliciesTable,
).omit({ id: true, funeralHomeId: true, createdAt: true, updatedAt: true });
export type InsertHomePolicy = z.infer<typeof insertHomePolicySchema>;
export type HomePolicy = typeof homePoliciesTable.$inferSelect;

/**
 * What a family or a stranger may see of a policy: the words, and nothing
 * about whether there are others they are not being shown.
 */
export type PublicHomePolicy = Pick<HomePolicy, "id" | "title" | "body">;

export function toPublicHomePolicy(row: HomePolicy): PublicHomePolicy {
  return { id: row.id, title: row.title, body: row.body };
}

/**
 * What a new home starts with.
 *
 * Unpublished, all of them, and phrased as prompts rather than as policy: a
 * home must never discover that this product published a sentence about
 * their deposits that they did not write. What the seeding buys is a
 * director opening the page and recognising the list, instead of facing an
 * empty screen and a button called "Add section".
 */
export const DEFAULT_POLICY_PROMPTS: ReadonlyArray<{
  title: string;
  body: string;
}> = [
  {
    title: "Deposits and payment",
    body: "What you ask for up front, when the balance is due, and what you accept. Families ask this first and are often embarrassed to.",
  },
  {
    title: "Bringing clothing in",
    body: "Where to bring it, who to ask for, and by when. Include whether jewellery comes back.",
  },
  {
    title: "Visitation and viewing",
    body: "Your hours, whether children are welcome, and what to expect walking in.",
  },
  {
    title: "Changing or cancelling arrangements",
    body: "What can still be changed, how late, and what cannot.",
  },
];

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
 * The home's library of hymns, readings, poems and music to choose from.
 *
 * This exists because of what happens without it. Asked "which hymns would
 * you like?", a grieving family stares at a blank box, cannot think of a
 * single one, and either picks whatever the director suggests or postpones
 * the decision until it becomes urgent. Almost nobody can recall the name of
 * a hymn on demand three days after a death, however many they have sung.
 *
 * A list they can read down is a different task entirely: recognition rather
 * than recall. It is the single cheapest improvement to this part of the
 * process, and it is why the library is seeded rather than starting empty.
 *
 * Homes edit their own copy. A Catholic home and a humanist celebrant want
 * very different lists, and neither should have to work around the other's.
 */
export const serviceLibraryTable = pgTable(
  "service_library",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    kind: text("kind").notNull(),
    title: text("title").notNull(),
    /** Author, composer, translator, or the book and verse. */
    attribution: text("attribution"),

    /**
     * The full text, for printing in the order of service.
     *
     * Null for anything still in copyright. That is not caution for its own
     * sake: this text gets printed onto two hundred pamphlets and handed out,
     * which is publication, and a funeral home is exactly the sort of small
     * business that cannot absorb a licensing complaint. Titles are not
     * copyrightable, so a modern song can be suggested by name with the text
     * left to whoever holds the rights.
     */
    body: text("body"),

    /** A first line or two, so a list is readable without opening anything. */
    excerpt: text("excerpt"),

    /**
     * Whether `body` may be printed. Stored rather than inferred, so that a
     * home adding its own material has to make the call deliberately.
     */
    printable: boolean("printable").notNull().default(false),

    /** Notes for the director: when this one tends to suit. */
    notes: text("notes"),

    enabled: boolean("enabled").notNull().default(true),
    position: integer("position").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("service_library_home_idx").on(
      table.funeralHomeId,
      table.kind,
      table.position,
    ),
  ],
);

export const LIBRARY_KINDS = [
  "hymn",
  "reading",
  "poem",
  "music",
  "prayer",
] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export const insertLibraryEntrySchema = createInsertSchema(
  serviceLibraryTable,
).omit({ id: true, funeralHomeId: true, createdAt: true, updatedAt: true });
export type InsertLibraryEntry = z.infer<typeof insertLibraryEntrySchema>;
export type LibraryEntry = typeof serviceLibraryTable.$inferSelect;

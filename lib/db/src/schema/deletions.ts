import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { funeralHomesTable } from "./funeral-homes";
import { usersTable } from "./users";

/**
 * What is left after a case is erased.
 *
 * A home that deletes a case on request needs to be able to say, later, that
 * it did — to a family who asked, to a regulator, to itself. A deletion that
 * leaves no trace at all is indistinguishable from data loss, and "we have no
 * record of that case ever existing" is the wrong answer to both questions it
 * might be asked.
 *
 * So a tombstone survives, and it holds deliberately almost nothing: which
 * home, who pressed the button, when, and the reason they typed. Not the
 * name of the person who died, not the family's names, not a count of
 * photographs. Keeping the decedent's name here would mean "delete everything
 * about my mother" quietly left her name in a table forever, which is not
 * what anybody meant by it.
 */
export const caseDeletionsTable = pgTable(
  "case_deletions",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /**
     * The id the case used to have. Useful for reconciling against the home's
     * own case-management system, and meaningless to anyone else.
     */
    formerCaseId: integer("former_case_id").notNull(),

    deletedByUserId: integer("deleted_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    /** Kept as text as well, because a staff member can be deleted too. */
    deletedByName: text("deleted_by_name"),
    reason: text("reason"),

    deletedAt: timestamp("deleted_at").notNull().defaultNow(),
  },
  (table) => [
    index("case_deletions_home_idx").on(table.funeralHomeId, table.deletedAt),
  ],
);

export type CaseDeletion = typeof caseDeletionsTable.$inferSelect;

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Signs — the cardinal on the fence on his birthday, the song on the radio,
 * the number that keeps turning up, the dream that felt like a visit.
 *
 * These are the things a bereaved parent most wants to write down at 11pm and
 * most regrets losing. Whether they mean anything is not this table's
 * business; keeping them is.
 */
export const signsTable = pgTable(
  "signs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    what: text("what").notNull(),
    story: text("story"),
    /** cardinal, feather, number, song, dream, butterfly, scent, other */
    kind: text("kind").notNull().default("other"),
    signDate: text("sign_date"),
    location: text("location"),
    /** The ones that stopped you in your tracks. */
    isSignificant: boolean("is_significant").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("signs_user_id_idx").on(table.userId)],
);

export const insertSignSchema = createInsertSchema(signsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type InsertSign = z.infer<typeof insertSignSchema>;
export type Sign = typeof signsTable.$inferSelect;

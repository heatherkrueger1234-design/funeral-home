import {
  pgTable,
  text,
  serial,
  timestamp,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * What arrived, who sent it, and whether a card went back.
 *
 * Flowers, food, money and cards arrive for weeks, mostly while the person
 * receiving them is incapable of recording anything. Then a month later there
 * is a pile of unlabelled dishes, a sense of owing everybody something, and no
 * way to reconstruct who sent what.
 *
 * `thanked` exists because the thank-you cards are one of the heaviest social
 * obligations bereaved parents describe, and the only thing that makes them
 * survivable is being able to do three at a time and see what is left. Nobody
 * needs a reminder here; they need a list that remembers for them.
 */
export const giftsTable = pgTable(
  "gifts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Who it came from. The one field that is always known. */
    fromName: text("from_name").notNull(),
    /** flowers, food, money, card, donation, gift, help, other */
    kind: text("kind").notNull().default("other"),
    /** "Lasagne, glass dish with a blue lid" — enough to return the dish. */
    description: text("description"),
    receivedDate: text("received_date"),
    thanked: boolean("thanked").notNull().default(false),
    /** Where to send the card. Often the actual blocker. */
    address: text("address"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("gifts_user_id_idx").on(table.userId)],
);

export const insertGiftSchema = createInsertSchema(giftsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGift = z.infer<typeof insertGiftSchema>;
export type Gift = typeof giftsTable.$inferSelect;

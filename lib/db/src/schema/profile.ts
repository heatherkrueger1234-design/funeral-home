import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const profileTable = pgTable(
  "profile",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    childName: text("child_name").notNull(),
    childBirthDate: text("child_birth_date"),
    childPassingDate: text("child_passing_date"),
    childAge: text("child_age"),
    parentName: text("parent_name"),
    /**
     * Who the person they lost was to them: child, partner, parent, sibling,
     * friend, other.
     *
     * An array, and not a single value, because grief is layered — one person
     * here lost a son, her mother, her father, her grandparents, a baby and
     * her best friend. Made to pick one box, she would have been shut out of
     * most of what she needed.
     *
     * It only ever reorders and labels the guides. Nothing is hidden from
     * anybody on the strength of it.
     */
    relationships: text("relationships").array(),
    causeOfDeath: text("cause_of_death"),
    favoriteColor: text("favorite_color"),
    favoriteFood: text("favorite_food"),
    favoriteAnimal: text("favorite_animal"),
    hobbies: text("hobbies"),
    personality: text("personality"),
    howTheySmelled: text("how_they_smelled"),
    whatDroveYouCrazy: text("what_drove_you_crazy"),
    lastHugDate: text("last_hug_date"),
    lastWords: text("last_words"),
    lastFight: text("last_fight"),
    photoUrl: text("photo_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("profile_user_id_idx").on(table.userId)],
);

export const insertProfileSchema = createInsertSchema(profileTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profileTable.$inferSelect;

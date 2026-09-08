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

export const todosTable = pgTable(
  "todos",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    completed: boolean("completed").notNull().default(false),
    category: text("category"),
    dueDate: text("due_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("todos_user_id_idx").on(table.userId)],
);

export const insertTodoSchema = createInsertSchema(todosTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type InsertTodo = z.infer<typeof insertTodoSchema>;
export type Todo = typeof todosTable.$inferSelect;

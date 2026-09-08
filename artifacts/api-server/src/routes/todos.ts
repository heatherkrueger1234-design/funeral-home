import { Router, type IRouter } from "express";
import { db, todosTable } from "@workspace/db";
import { CreateTodoBody, UpdateTodoBody } from "@workspace/api-zod";
import { eq, desc, and } from "drizzle-orm";
import { assertHasUpdates, parseBody, parseId, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

router.get("/todos", async (req, res) => {
  const user = currentUser(req);
  const rows = await db
    .select()
    .from(todosTable)
    .where(eq(todosTable.userId, user.id))
    .orderBy(desc(todosTable.createdAt));

  res.json(rows);
});

router.post("/todos", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateTodoBody, req.body);

  const [created] = await db
    .insert(todosTable)
    .values({
      ...values,
      userId: user.id,
      completed: values.completed ?? false,
    })
    .returning();

  res.status(201).json(created);
});

router.put("/todos/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const values = assertHasUpdates(
    parseBody(UpdateTodoBody.partial(), req.body),
  );

  const [updated] = await db
    .update(todosTable)
    .set(values)
    .where(and(eq(todosTable.id, id), eq(todosTable.userId, user.id)))
    .returning();

  res.json(requireRow(updated, `Todo ${id} not found`));
});

router.delete("/todos/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(todosTable)
    .where(and(eq(todosTable.id, id), eq(todosTable.userId, user.id)))
    .returning({ id: todosTable.id });

  requireRow(deleted, `Todo ${id} not found`);
  res.status(204).end();
});

export default router;

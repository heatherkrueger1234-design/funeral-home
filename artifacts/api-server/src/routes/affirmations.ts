import { Router, type IRouter } from "express";
import { db, affirmationsTable } from "@workspace/db";
import { CreateAffirmationBody } from "@workspace/api-zod";
import { eq, desc, and } from "drizzle-orm";
import { parseBody, parseId, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

router.get("/affirmations", async (req, res) => {
  const user = currentUser(req);
  const rows = await db
    .select()
    .from(affirmationsTable)
    .where(eq(affirmationsTable.userId, user.id))
    .orderBy(desc(affirmationsTable.createdAt));

  res.json(rows);
});

router.post("/affirmations", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateAffirmationBody, req.body);

  const [created] = await db
    .insert(affirmationsTable)
    .values({
      ...values,
      userId: user.id,
      isFavorite: values.isFavorite ?? false,
    })
    .returning();

  res.status(201).json(created);
});

router.delete("/affirmations/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(affirmationsTable)
    .where(
      and(eq(affirmationsTable.id, id), eq(affirmationsTable.userId, user.id)),
    )
    .returning({ id: affirmationsTable.id });

  requireRow(deleted, `Affirmation ${id} not found`);
  res.status(204).end();
});

export default router;

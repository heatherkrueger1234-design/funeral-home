import { Router, type IRouter } from "express";
import { db, storiesTable } from "@workspace/db";
import { CreateStoryBody } from "@workspace/api-zod";
import { eq, desc, and } from "drizzle-orm";
import { parseBody, parseId, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

router.get("/stories", async (req, res) => {
  const user = currentUser(req);
  const rows = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.userId, user.id))
    .orderBy(desc(storiesTable.createdAt));

  res.json(rows);
});

router.post("/stories", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateStoryBody, req.body);

  const [created] = await db
    .insert(storiesTable)
    .values({ ...values, userId: user.id })
    .returning();

  res.status(201).json(created);
});

router.delete("/stories/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(storiesTable)
    .where(and(eq(storiesTable.id, id), eq(storiesTable.userId, user.id)))
    .returning({ id: storiesTable.id });

  requireRow(deleted, `Story ${id} not found`);
  res.status(204).end();
});

export default router;

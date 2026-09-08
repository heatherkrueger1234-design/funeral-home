import { Router, type IRouter } from "express";
import { db, memorialChoicesTable } from "@workspace/db";
import { CreateMemorialChoiceBody, UpdateMemorialChoiceBody } from "@workspace/api-zod";
import { eq, and, asc } from "drizzle-orm";
import { assertHasUpdates, parseBody, parseId, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

router.get("/memorial-choices", async (req, res) => {
  const user = currentUser(req);
  const rows = await db
    .select()
    .from(memorialChoicesTable)
    .where(eq(memorialChoicesTable.userId, user.id))
    .orderBy(asc(memorialChoicesTable.category));

  res.json(rows);
});

router.post("/memorial-choices", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateMemorialChoiceBody, req.body);

  const [created] = await db
    .insert(memorialChoicesTable)
    .values({ ...values, userId: user.id })
    .returning();

  res.status(201).json(created);
});

router.put("/memorial-choices/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const values = assertHasUpdates(
    parseBody(UpdateMemorialChoiceBody.partial(), req.body),
  );

  const [updated] = await db
    .update(memorialChoicesTable)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(memorialChoicesTable.id, id), eq(memorialChoicesTable.userId, user.id)))
    .returning();

  res.json(requireRow(updated, `Choice ${id} not found`));
});

router.delete("/memorial-choices/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(memorialChoicesTable)
    .where(and(eq(memorialChoicesTable.id, id), eq(memorialChoicesTable.userId, user.id)))
    .returning({ id: memorialChoicesTable.id });

  requireRow(deleted, `Choice ${id} not found`);
  res.status(204).end();
});

export default router;

import { Router, type IRouter } from "express";
import { db, giftsTable } from "@workspace/db";
import { CreateGiftBody, UpdateGiftBody } from "@workspace/api-zod";
import { eq, and, asc } from "drizzle-orm";
import { assertHasUpdates, parseBody, parseId, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

router.get("/gifts", async (req, res) => {
  const user = currentUser(req);
  const rows = await db
    .select()
    .from(giftsTable)
    .where(eq(giftsTable.userId, user.id))
    .orderBy(asc(giftsTable.fromName));

  res.json(rows);
});

router.post("/gifts", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateGiftBody, req.body);

  const [created] = await db
    .insert(giftsTable)
    .values({ ...values, userId: user.id })
    .returning();

  res.status(201).json(created);
});

router.put("/gifts/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const values = assertHasUpdates(
    parseBody(UpdateGiftBody.partial(), req.body),
  );

  const [updated] = await db
    .update(giftsTable)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(giftsTable.id, id), eq(giftsTable.userId, user.id)))
    .returning();

  res.json(requireRow(updated, `Gift ${id} not found`));
});

router.delete("/gifts/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(giftsTable)
    .where(and(eq(giftsTable.id, id), eq(giftsTable.userId, user.id)))
    .returning({ id: giftsTable.id });

  requireRow(deleted, `Gift ${id} not found`);
  res.status(204).end();
});

export default router;

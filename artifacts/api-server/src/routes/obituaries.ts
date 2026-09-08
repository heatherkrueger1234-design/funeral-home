import { Router, type IRouter } from "express";
import { db, obituariesTable } from "@workspace/db";
import { CreateObituaryBody, UpdateObituaryBody } from "@workspace/api-zod";
import { eq, and, desc } from "drizzle-orm";
import { assertHasUpdates, parseBody, parseId, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

router.get("/obituaries", async (req, res) => {
  const user = currentUser(req);
  const rows = await db
    .select()
    .from(obituariesTable)
    .where(eq(obituariesTable.userId, user.id))
    .orderBy(desc(obituariesTable.updatedAt));

  res.json(rows);
});

router.post("/obituaries", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateObituaryBody, req.body);

  const [created] = await db
    .insert(obituariesTable)
    .values({ ...values, userId: user.id })
    .returning();

  res.status(201).json(created);
});

router.put("/obituaries/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const values = assertHasUpdates(
    parseBody(UpdateObituaryBody.partial(), req.body),
  );

  const [updated] = await db
    .update(obituariesTable)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(obituariesTable.id, id), eq(obituariesTable.userId, user.id)))
    .returning();

  res.json(requireRow(updated, `Obituary ${id} not found`));
});

router.delete("/obituaries/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(obituariesTable)
    .where(and(eq(obituariesTable.id, id), eq(obituariesTable.userId, user.id)))
    .returning({ id: obituariesTable.id });

  requireRow(deleted, `Obituary ${id} not found`);
  res.status(204).end();
});

export default router;

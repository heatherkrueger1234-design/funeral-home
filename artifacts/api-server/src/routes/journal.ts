import { Router, type IRouter } from "express";
import { db, journalTable } from "@workspace/db";
import {
  CreateJournalEntryBody,
  UpdateJournalEntryBody,
} from "@workspace/api-zod";
import { eq, desc, and } from "drizzle-orm";
import { assertHasUpdates, parseBody, parseId, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

router.get("/journal", async (req, res) => {
  const user = currentUser(req);
  const rows = await db
    .select()
    .from(journalTable)
    .where(eq(journalTable.userId, user.id))
    .orderBy(desc(journalTable.createdAt));

  res.json(rows);
});

router.post("/journal", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateJournalEntryBody, req.body);

  const [created] = await db
    .insert(journalTable)
    .values({ ...values, userId: user.id })
    .returning();

  res.status(201).json(created);
});

router.put("/journal/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const values = assertHasUpdates(
    parseBody(UpdateJournalEntryBody.partial(), req.body),
  );

  const [updated] = await db
    .update(journalTable)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(journalTable.id, id), eq(journalTable.userId, user.id)))
    .returning();

  res.json(requireRow(updated, `Journal entry ${id} not found`));
});

router.delete("/journal/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(journalTable)
    .where(and(eq(journalTable.id, id), eq(journalTable.userId, user.id)))
    .returning({ id: journalTable.id });

  requireRow(deleted, `Journal entry ${id} not found`);
  res.status(204).end();
});

export default router;

import { Router, type IRouter } from "express";
import { db, contactsTable } from "@workspace/db";
import { CreateContactBody, UpdateContactBody } from "@workspace/api-zod";
import { eq, and, asc } from "drizzle-orm";
import { assertHasUpdates, parseBody, parseId, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

router.get("/contacts", async (req, res) => {
  const user = currentUser(req);
  const rows = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.userId, user.id))
    .orderBy(asc(contactsTable.name));

  res.json(rows);
});

router.post("/contacts", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateContactBody, req.body);

  const [created] = await db
    .insert(contactsTable)
    .values({ ...values, userId: user.id })
    .returning();

  res.status(201).json(created);
});

router.put("/contacts/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const values = assertHasUpdates(
    parseBody(UpdateContactBody.partial(), req.body),
  );

  const [updated] = await db
    .update(contactsTable)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(contactsTable.id, id), eq(contactsTable.userId, user.id)))
    .returning();

  res.json(requireRow(updated, `Contact ${id} not found`));
});

router.delete("/contacts/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(contactsTable)
    .where(and(eq(contactsTable.id, id), eq(contactsTable.userId, user.id)))
    .returning({ id: contactsTable.id });

  requireRow(deleted, `Contact ${id} not found`);
  res.status(204).end();
});

export default router;

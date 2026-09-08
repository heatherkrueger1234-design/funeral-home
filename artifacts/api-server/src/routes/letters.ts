import { Router, type IRouter } from "express";
import { db, lettersTable } from "@workspace/db";
import {
  CreateLetterBody,
  GetLettersQueryParams,
  UpdateLetterBody,
} from "@workspace/api-zod";
import { eq, desc, and } from "drizzle-orm";
import {
  assertHasUpdates,
  parseBody,
  parseId,
  parseQuery,
  requireRow,
} from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

router.get("/letters", async (req, res) => {
  const user = currentUser(req);
  const { direction } = parseQuery(GetLettersQueryParams, req.query);
  const filter = direction ? eq(lettersTable.direction, direction) : undefined;

  const rows = await db
    .select()
    .from(lettersTable)
    .where(and(eq(lettersTable.userId, user.id), filter))
    .orderBy(desc(lettersTable.createdAt));

  res.json(rows);
});

router.post("/letters", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateLetterBody, req.body);

  const [created] = await db
    .insert(lettersTable)
    .values({ ...values, userId: user.id })
    .returning();

  res.status(201).json(created);
});

router.put("/letters/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const values = assertHasUpdates(
    parseBody(UpdateLetterBody.partial(), req.body),
  );

  const [updated] = await db
    .update(lettersTable)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(lettersTable.id, id), eq(lettersTable.userId, user.id)))
    .returning();

  res.json(requireRow(updated, `Letter ${id} not found`));
});

router.delete("/letters/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(lettersTable)
    .where(and(eq(lettersTable.id, id), eq(lettersTable.userId, user.id)))
    .returning({ id: lettersTable.id });

  requireRow(deleted, `Letter ${id} not found`);
  res.status(204).end();
});

export default router;

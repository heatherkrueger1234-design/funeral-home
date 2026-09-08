import { Router, type IRouter } from "express";
import { db, signsTable } from "@workspace/db";
import { CreateSignBody, UpdateSignBody } from "@workspace/api-zod";
import { eq, and, desc } from "drizzle-orm";
import {
  assertHasUpdates,
  parseBody,
  parseId,
  requireRow,
} from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

router.get("/signs", async (req, res) => {
  const user = currentUser(req);

  const rows = await db
    .select()
    .from(signsTable)
    .where(eq(signsTable.userId, user.id))
    .orderBy(desc(signsTable.createdAt));

  res.json(rows);
});

router.post("/signs", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateSignBody, req.body);

  const [created] = await db
    .insert(signsTable)
    .values({
      ...values,
      userId: user.id,
      kind: values.kind ?? "other",
      isSignificant: values.isSignificant ?? false,
    })
    .returning();

  res.status(201).json(created);
});

router.put("/signs/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const values = assertHasUpdates(parseBody(UpdateSignBody.partial(), req.body));

  const [updated] = await db
    .update(signsTable)
    .set(values)
    .where(and(eq(signsTable.id, id), eq(signsTable.userId, user.id)))
    .returning();

  res.json(requireRow(updated, `Sign ${id} not found`));
});

router.delete("/signs/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(signsTable)
    .where(and(eq(signsTable.id, id), eq(signsTable.userId, user.id)))
    .returning({ id: signsTable.id });

  requireRow(deleted, `Sign ${id} not found`);
  res.status(204).end();
});

export default router;

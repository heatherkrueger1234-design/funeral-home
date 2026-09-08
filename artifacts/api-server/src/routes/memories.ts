import { Router, type IRouter } from "express";
import { db, memoriesTable } from "@workspace/db";
import {
  CreateMemoryBody,
  GetMemoriesQueryParams,
  UpdateMemoryBody,
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

router.get("/memories", async (req, res) => {
  const user = currentUser(req);
  const { category } = parseQuery(GetMemoriesQueryParams, req.query);
  const filter = category?.trim()
    ? eq(memoriesTable.category, category.trim())
    : undefined;

  const rows = await db
    .select()
    .from(memoriesTable)
    .where(and(eq(memoriesTable.userId, user.id), filter))
    .orderBy(desc(memoriesTable.createdAt));

  res.json(rows);
});

router.post("/memories", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateMemoryBody, req.body);

  const [created] = await db
    .insert(memoriesTable)
    .values({
      ...values,
      userId: user.id,
      isAiGenerated: values.isAiGenerated ?? false,
    })
    .returning();

  res.status(201).json(created);
});

router.put("/memories/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const values = assertHasUpdates(
    parseBody(UpdateMemoryBody.partial(), req.body),
  );

  const [updated] = await db
    .update(memoriesTable)
    .set(values)
    .where(and(eq(memoriesTable.id, id), eq(memoriesTable.userId, user.id)))
    .returning();

  res.json(requireRow(updated, `Memory ${id} not found`));
});

router.delete("/memories/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(memoriesTable)
    .where(and(eq(memoriesTable.id, id), eq(memoriesTable.userId, user.id)))
    .returning({ id: memoriesTable.id });

  requireRow(deleted, `Memory ${id} not found`);
  res.status(204).end();
});

export default router;

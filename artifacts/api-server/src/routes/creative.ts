import { Router, type IRouter } from "express";
import { db, creativeTable } from "@workspace/db";
import {
  CreateCreativeWorkBody,
  GetCreativeWorksQueryParams,
  UpdateCreativeWorkBody,
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

router.get("/creative", async (req, res) => {
  const user = currentUser(req);
  const { type } = parseQuery(GetCreativeWorksQueryParams, req.query);
  const filter = type ? eq(creativeTable.type, type) : undefined;

  const rows = await db
    .select()
    .from(creativeTable)
    .where(and(eq(creativeTable.userId, user.id), filter))
    .orderBy(desc(creativeTable.createdAt));

  res.json(rows);
});

router.post("/creative", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateCreativeWorkBody, req.body);

  const [created] = await db
    .insert(creativeTable)
    .values({ ...values, userId: user.id })
    .returning();

  res.status(201).json(created);
});

router.put("/creative/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const values = assertHasUpdates(
    parseBody(UpdateCreativeWorkBody.partial(), req.body),
  );

  const [updated] = await db
    .update(creativeTable)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(creativeTable.id, id), eq(creativeTable.userId, user.id)))
    .returning();

  res.json(requireRow(updated, `Creative work ${id} not found`));
});

router.delete("/creative/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(creativeTable)
    .where(and(eq(creativeTable.id, id), eq(creativeTable.userId, user.id)))
    .returning({ id: creativeTable.id });

  requireRow(deleted, `Creative work ${id} not found`);
  res.status(204).end();
});

export default router;

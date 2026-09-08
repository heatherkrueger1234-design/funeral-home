import { Router, type IRouter } from "express";
import { db, belongingsTable } from "@workspace/db";
import { CreateBelongingBody, UpdateBelongingBody } from "@workspace/api-zod";
import { eq, and, asc } from "drizzle-orm";
import { assertHasUpdates, parseBody, parseId, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

router.get("/belongings", async (req, res) => {
  const user = currentUser(req);
  const rows = await db
    .select()
    .from(belongingsTable)
    .where(eq(belongingsTable.userId, user.id))
    .orderBy(asc(belongingsTable.item));

  res.json(rows);
});

router.post("/belongings", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateBelongingBody, req.body);

  const [created] = await db
    .insert(belongingsTable)
    .values({ ...values, userId: user.id })
    .returning();

  res.status(201).json(created);
});

router.put("/belongings/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const values = assertHasUpdates(
    parseBody(UpdateBelongingBody.partial(), req.body),
  );

  const [updated] = await db
    .update(belongingsTable)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(belongingsTable.id, id), eq(belongingsTable.userId, user.id)))
    .returning();

  res.json(requireRow(updated, `Belonging ${id} not found`));
});

router.delete("/belongings/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(belongingsTable)
    .where(and(eq(belongingsTable.id, id), eq(belongingsTable.userId, user.id)))
    .returning({ id: belongingsTable.id });

  requireRow(deleted, `Belonging ${id} not found`);
  res.status(204).end();
});

export default router;

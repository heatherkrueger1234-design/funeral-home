import { Router, type IRouter } from "express";
import { db, milestonesTable } from "@workspace/db";
import { CreateMilestoneBody } from "@workspace/api-zod";
import { eq, desc, and } from "drizzle-orm";
import { parseBody, parseId, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

router.get("/milestones", async (req, res) => {
  const user = currentUser(req);
  const rows = await db
    .select()
    .from(milestonesTable)
    .where(eq(milestonesTable.userId, user.id))
    .orderBy(desc(milestonesTable.milestoneDate));

  res.json(rows);
});

router.post("/milestones", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateMilestoneBody, req.body);

  const [created] = await db
    .insert(milestonesTable)
    .values({
      ...values,
      userId: user.id,
      isChildMilestone: values.isChildMilestone ?? true,
    })
    .returning();

  res.status(201).json(created);
});

router.delete("/milestones/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(milestonesTable)
    .where(and(eq(milestonesTable.id, id), eq(milestonesTable.userId, user.id)))
    .returning({ id: milestonesTable.id });

  requireRow(deleted, `Milestone ${id} not found`);
  res.status(204).end();
});

export default router;

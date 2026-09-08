import { Router, type IRouter } from "express";
import { db, tributeTable } from "@workspace/db";
import { UpdateTributeBody } from "@workspace/api-zod";
import { eq, and, asc } from "drizzle-orm";
import { parseBody } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

/**
 * The tribute is a singleton *per account*. Ordering by id keeps every request
 * pointed at the same row even if a race ever created a second one.
 */
async function findTribute(userId: number) {
  const [tribute] = await db
    .select()
    .from(tributeTable)
    .where(eq(tributeTable.userId, userId))
    .orderBy(asc(tributeTable.id))
    .limit(1);

  return tribute;
}

router.get("/tribute", async (req, res) => {
  const user = currentUser(req);

  const tribute =
    (await findTribute(user.id)) ??
    (await db.insert(tributeTable).values({ userId: user.id }).returning())[0];

  res.json(tribute);
});

router.put("/tribute", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(UpdateTributeBody.partial(), req.body);
  const tribute = await findTribute(user.id);

  if (!tribute) {
    const [created] = await db
      .insert(tributeTable)
      .values({ ...values, userId: user.id })
      .returning();

    res.json(created);
    return;
  }

  const [updated] = await db
    .update(tributeTable)
    .set({ ...values, updatedAt: new Date() })
    .where(
      and(eq(tributeTable.id, tribute.id), eq(tributeTable.userId, user.id)),
    )
    .returning();

  res.json(updated);
});

export default router;

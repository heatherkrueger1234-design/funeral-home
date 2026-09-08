import { Router, type IRouter } from "express";
import { db, profileTable } from "@workspace/db";
import { UpdateProfileBody } from "@workspace/api-zod";
import { eq, and, asc } from "drizzle-orm";
import { badRequest, parseBody } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

const DEFAULT_CHILD_NAME = "Your Child";

/**
 * The profile is a singleton *per account*. Ordering by id keeps every request
 * pointed at the same row even if a race ever created a second one.
 */
async function findProfile(userId: number) {
  const [profile] = await db
    .select()
    .from(profileTable)
    .where(eq(profileTable.userId, userId))
    .orderBy(asc(profileTable.id))
    .limit(1);

  return profile;
}

router.get("/profile", async (req, res) => {
  const user = currentUser(req);

  const profile =
    (await findProfile(user.id)) ??
    (
      await db
        .insert(profileTable)
        .values({ userId: user.id, childName: DEFAULT_CHILD_NAME })
        .returning()
    )[0];

  res.json(profile);
});

router.put("/profile", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(UpdateProfileBody.partial(), req.body);

  if (values.childName !== undefined && values.childName.trim() === "") {
    throw badRequest("childName cannot be empty");
  }

  const profile = await findProfile(user.id);

  if (!profile) {
    const [created] = await db
      .insert(profileTable)
      .values({
        ...values,
        userId: user.id,
        childName: values.childName ?? DEFAULT_CHILD_NAME,
      })
      .returning();

    res.json(created);
    return;
  }

  const [updated] = await db
    .update(profileTable)
    .set({ ...values, updatedAt: new Date() })
    .where(
      and(eq(profileTable.id, profile.id), eq(profileTable.userId, user.id)),
    )
    .returning();

  res.json(updated);
});

export default router;

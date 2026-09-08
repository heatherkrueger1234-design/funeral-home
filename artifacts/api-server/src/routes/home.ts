import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, funeralHomesTable, usersTable, toPublicUser } from "@workspace/db";
import { UpdateHomeBody } from "@workspace/api-zod";
import { assertHasUpdates, badRequest, parseBody } from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";

const router: IRouter = Router();

router.get("/home", (req, res) => {
  res.json(tenant(req));
});

router.put("/home", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);

  // Branding and hours are the home's shopfront and its staff's evenings.
  // Both are the owner's call, not any signed-in employee's.
  if (user.role !== "owner") {
    throw badRequest("Only an owner can change the home's settings.");
  }

  const values = assertHasUpdates(parseBody(UpdateHomeBody, req.body));

  if (values.accentColor && !/^#[0-9a-fA-F]{6}$/.test(values.accentColor)) {
    throw badRequest("An accent colour must be a hex value such as #1f4e46.");
  }

  // A timezone that Intl cannot resolve would make every office-hours
  // comparison throw, at request time, on the family's phone.
  if (values.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: values.timezone });
    } catch {
      throw badRequest(`"${values.timezone}" is not a timezone this server knows.`);
    }
  }

  const [updated] = await db
    .update(funeralHomesTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();

  res.json(updated);
});

router.get("/home/staff", async (req, res) => {
  const home = tenant(req);

  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.funeralHomeId, home.id))
    .orderBy(asc(usersTable.displayName), asc(usersTable.email));

  res.json(rows.map(toPublicUser));
});

export default router;

import { Router, type IRouter } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, homePoliciesTable, type HomePolicy } from "@workspace/db";
import { CreateHomePolicyBody, UpdateHomePolicyBody } from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  HttpError,
  parseBody,
  parseId,
} from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";

/**
 * The home's own words: what it says the same way to every family.
 *
 * Owner-only to write, like the rest of the shopfront. A published section
 * is on the public internet under the home's name, and "anyone who works
 * here can edit what the business says about its deposits" is not a
 * permission model a funeral home's owner would choose if asked.
 */

const router: IRouter = Router();

/** How many sections a page can hold before it stops being read. */
const MAX_POLICIES = 20;

function toPolicyJson(row: HomePolicy) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    position: row.position,
    published: row.published,
  };
}

function assertOwner(req: Parameters<typeof currentUser>[0]): void {
  if (currentUser(req).role !== "owner") {
    throw badRequest("Only an owner can change what the home publishes.");
  }
}

router.get("/home/policies", async (req, res) => {
  const home = tenant(req);

  const rows = await db
    .select()
    .from(homePoliciesTable)
    .where(eq(homePoliciesTable.funeralHomeId, home.id))
    .orderBy(asc(homePoliciesTable.position), asc(homePoliciesTable.id));

  res.json(rows.map(toPolicyJson));
});

router.post("/home/policies", async (req, res) => {
  const home = tenant(req);
  assertOwner(req);

  const values = parseBody(CreateHomePolicyBody, req.body);

  const [count] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(homePoliciesTable)
    .where(eq(homePoliciesTable.funeralHomeId, home.id));

  if ((count?.value ?? 0) >= MAX_POLICIES) {
    throw badRequest(
      `That is ${MAX_POLICIES} sections. A page nobody finishes reading is a page that answered nothing.`,
    );
  }

  const [created] = await db
    .insert(homePoliciesTable)
    .values({
      funeralHomeId: home.id,
      title: values.title.trim(),
      body: values.body.trim(),
      // Unpublished unless the owner explicitly says otherwise. The first
      // draft of the paragraph about money is not the one to put on the
      // internet, and defaulting the other way would publish it before
      // anyone had read it back.
      published: values.published ?? false,
      position: count?.value ?? 0,
    })
    .returning();

  res.status(201).json(toPolicyJson(created!));
});

router.put("/policies/:policyId", async (req, res) => {
  const home = tenant(req);
  assertOwner(req);

  const id = parseId(req.params.policyId);
  const values = assertHasUpdates(parseBody(UpdateHomePolicyBody, req.body));

  const [updated] = await db
    .update(homePoliciesTable)
    .set({
      ...values,
      ...(values.title === undefined ? {} : { title: values.title.trim() }),
      ...(values.body === undefined ? {} : { body: values.body.trim() }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(homePoliciesTable.id, id),
        eq(homePoliciesTable.funeralHomeId, home.id),
      ),
    )
    .returning();

  if (!updated) throw new HttpError(404, "No such section.");

  res.json(toPolicyJson(updated));
});

router.delete("/policies/:policyId", async (req, res) => {
  const home = tenant(req);
  assertOwner(req);

  const id = parseId(req.params.policyId);

  const [deleted] = await db
    .delete(homePoliciesTable)
    .where(
      and(
        eq(homePoliciesTable.id, id),
        eq(homePoliciesTable.funeralHomeId, home.id),
      ),
    )
    .returning({ id: homePoliciesTable.id });

  if (!deleted) throw new HttpError(404, "No such section.");

  res.status(204).end();
});

export default router;

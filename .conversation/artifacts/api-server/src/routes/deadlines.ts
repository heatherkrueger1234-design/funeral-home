import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  caseDeadlinesTable,
  familyContactsTable,
  usersTable,
  type CaseDeadline,
} from "@workspace/db";
import { CreateDeadlineBody, UpdateDeadlineBody } from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  parseBody,
  parseId,
  requireRow,
} from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import { applyTemplateToCase } from "../lib/timeline";
import { loadCase } from "./cases";

const router: IRouter = Router();

/**
 * The timeline, with the name of whoever ticked each item off.
 *
 * Resolving the name matters more than it looks: "delivered by Anne" tells
 * the director the daughter has been in and done it, which is the difference
 * between chasing her and leaving her alone.
 */
export async function deadlinesForCase(caseId: number, funeralHomeId: number) {
  const rows = await db
    .select({
      deadline: caseDeadlinesTable,
      staffName: usersTable.displayName,
      contactName: familyContactsTable.name,
    })
    .from(caseDeadlinesTable)
    .leftJoin(usersTable, eq(usersTable.id, caseDeadlinesTable.completedByUserId))
    .leftJoin(
      familyContactsTable,
      eq(familyContactsTable.id, caseDeadlinesTable.completedByContactId),
    )
    .where(
      and(
        eq(caseDeadlinesTable.caseId, caseId),
        eq(caseDeadlinesTable.funeralHomeId, funeralHomeId),
      ),
    )
    .orderBy(asc(caseDeadlinesTable.dueAt), asc(caseDeadlinesTable.position));

  return rows.map(({ deadline, staffName, contactName }) => ({
    id: deadline.id,
    caseId: deadline.caseId,
    title: deadline.title,
    description: deadline.description,
    dueAt: deadline.dueAt,
    isEvent: deadline.isEvent,
    completedAt: deadline.completedAt,
    completedByName: staffName ?? contactName ?? null,
    position: deadline.position,
  }));
}

async function loadDeadline(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
): Promise<CaseDeadline> {
  const home = tenant(req);
  const id = parseId(rawId);

  const [row] = await db
    .select()
    .from(caseDeadlinesTable)
    .where(
      and(
        eq(caseDeadlinesTable.id, id),
        eq(caseDeadlinesTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  return requireRow(row, "That timeline entry could not be found.");
}

router.get("/cases/:caseId/deadlines", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  res.json(await deadlinesForCase(row.id, home.id));
});

router.post("/cases/:caseId/deadlines", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const values = parseBody(CreateDeadlineBody, req.body);

  const title = values.title.trim();
  if (!title) throw badRequest("Please say what is due.");

  const [created] = await db
    .insert(caseDeadlinesTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      title,
      description: values.description ?? null,
      dueAt: values.dueAt,
      isEvent: values.isEvent ?? false,
    })
    .returning();

  res.status(201).json({
    ...created!,
    completedByName: null,
  });
});

/**
 * Build or rebuild this case's timeline from the home's standard schedule.
 *
 * Safe to press twice, and safe to press after moving the service: steps are
 * matched by title, unfinished ones move with the date, and anything the
 * family has already done is left exactly where it is.
 */
router.post("/cases/:caseId/deadlines/from-template", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  if (!row.serviceAt) {
    throw badRequest(
      "Set the service date first — every step is measured from it.",
    );
  }

  await applyTemplateToCase(row);

  res.json(await deadlinesForCase(row.id, home.id));
});

router.put("/deadlines/:deadlineId", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const existing = await loadDeadline(req, req.params.deadlineId);
  const { completed, ...values } = assertHasUpdates(
    parseBody(UpdateDeadlineBody, req.body),
  );

  // An event is a thing that happens, not a thing to do. Ticking off the
  // funeral itself is never meaningful.
  if (completed === true && (values.isEvent ?? existing.isEvent)) {
    throw badRequest("An event on the timeline can't be marked done.");
  }

  await db
    .update(caseDeadlinesTable)
    .set({
      ...values,
      ...(completed === undefined
        ? {}
        : completed
          ? { completedAt: new Date(), completedByUserId: user.id, completedByContactId: null }
          : { completedAt: null, completedByUserId: null, completedByContactId: null }),
      updatedAt: new Date(),
    })
    .where(eq(caseDeadlinesTable.id, existing.id));

  const all = await deadlinesForCase(existing.caseId, home.id);
  res.json(all.find((row) => row.id === existing.id));
});

router.delete("/deadlines/:deadlineId", async (req, res) => {
  const existing = await loadDeadline(req, req.params.deadlineId);

  await db
    .delete(caseDeadlinesTable)
    .where(eq(caseDeadlinesTable.id, existing.id));

  res.status(204).end();
});

export default router;

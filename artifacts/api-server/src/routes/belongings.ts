import { Router, type IRouter } from "express";
import { and, eq, max } from "drizzle-orm";
import {
  db,
  caseBelongingsTable,
  casePreparationTable,
  type CaseBelonging,
} from "@workspace/db";
import {
  CreateBelongingBody,
  UpdateBelongingBody,
  UpdatePreparationBody,
} from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  parseBody,
  parseId,
  requireRow,
} from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import {
  belongingsForCase,
  ensureBelongingPrompts,
  preparationForCase,
  toPreparationJson,
} from "../lib/belongings";
import { loadCase } from "./cases";

const router: IRouter = Router();

async function loadBelonging(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
): Promise<CaseBelonging> {
  const home = tenant(req);
  const id = parseId(rawId);

  const [row] = await db
    .select()
    .from(caseBelongingsTable)
    .where(
      and(
        eq(caseBelongingsTable.id, id),
        eq(caseBelongingsTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  return requireRow(row, "That item could not be found.");
}

router.get("/cases/:caseId/belongings", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  await ensureBelongingPrompts(row.id, home.id);

  res.json(await belongingsForCase(row.id, home.id));
});

router.post("/cases/:caseId/belongings", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const values = parseBody(CreateBelongingBody, req.body);

  const description = values.description.trim();
  if (!description) throw badRequest("Please describe the item.");

  const [last] = await db
    .select({ value: max(caseBelongingsTable.position) })
    .from(caseBelongingsTable)
    .where(eq(caseBelongingsTable.caseId, row.id));

  const [created] = await db
    .insert(caseBelongingsTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      kind: values.kind ?? "other",
      description,
      disposition: values.disposition ?? "undecided",
      notes: values.notes ?? null,
      position: (last?.value ?? -1) + 1,
    })
    .returning();

  const all = await belongingsForCase(row.id, home.id);
  res.status(201).json(all.find((item) => item.id === created!.id));
});

/**
 * The chain of custody is a side effect of doing the work.
 *
 * Marking an item received stamps the time and the staff member without
 * anyone filling in a second form. That is the only way a record like this
 * survives contact with a busy week — a separate "log custody" step is one
 * nobody performs at four in the afternoon with a family waiting.
 */
router.put("/belongings/:belongingId", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const existing = await loadBelonging(req, req.params.belongingId);
  const values = assertHasUpdates(parseBody(UpdateBelongingBody, req.body));

  const now = new Date();
  const custody: Record<string, unknown> = {};

  if (values.status && values.status !== existing.status) {
    if (values.status === "received" && existing.receivedAt === null) {
      custody.receivedAt = now;
      custody.receivedByUserId = user.id;
    }

    if (values.status === "returned") {
      custody.returnedAt = now;
      custody.returnedByUserId = user.id;
    }

    // Reopening an item clears the return, or a mistake would leave the row
    // claiming it was both handed back and still in the building.
    if (values.status === "received" || values.status === "with_deceased") {
      custody.returnedAt = null;
      custody.returnedByUserId = null;
    }
  }

  const [updated] = await db
    .update(caseBelongingsTable)
    .set({ ...values, ...custody, updatedAt: now })
    .where(eq(caseBelongingsTable.id, existing.id))
    .returning();

  const all = await belongingsForCase(existing.caseId, home.id);
  res.json(all.find((item) => item.id === updated!.id));
});

router.delete("/belongings/:belongingId", async (req, res) => {
  const existing = await loadBelonging(req, req.params.belongingId);

  // Once something has physically been handed over, the row is the record of
  // that. Deleting it would remove the only evidence the home has.
  if (existing.receivedAt !== null) {
    throw badRequest(
      "This item has been taken in, so its record stays. Mark it returned instead.",
    );
  }

  await db
    .delete(caseBelongingsTable)
    .where(eq(caseBelongingsTable.id, existing.id));

  res.status(204).end();
});

/* ------------------------------------------------ the preparation sheet -- */

router.get("/cases/:caseId/preparation", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const sheet = await preparationForCase(row.id, home.id);

  res.json(await toPreparationJson(sheet, row.referencePhotoId));
});

router.put("/cases/:caseId/preparation", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const sheet = await preparationForCase(row.id, home.id);

  const { reviewed, ...values } = assertHasUpdates(
    parseBody(UpdatePreparationBody, req.body),
  );

  const [updated] = await db
    .update(casePreparationTable)
    .set({
      ...values,
      ...(reviewed === undefined
        ? {}
        : reviewed
          ? { reviewedAt: new Date(), reviewedByUserId: user.id }
          : { reviewedAt: null, reviewedByUserId: null }),
      updatedAt: new Date(),
    })
    .where(eq(casePreparationTable.id, sheet.id))
    .returning();

  res.json(await toPreparationJson(updated!, row.referencePhotoId));
});

export default router;

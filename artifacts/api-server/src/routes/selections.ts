import { Router, type IRouter } from "express";
import { and, asc, eq, max } from "drizzle-orm";
import { db, serviceSelectionsTable, type ServiceSelection } from "@workspace/db";
import { CreateSelectionBody, UpdateSelectionBody } from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  parseBody,
  parseId,
  requireRow,
} from "../lib/http";
import { tenant } from "../middleware/require-auth";
import { loadCase } from "./cases";

const router: IRouter = Router();

export async function selectionsForCase(caseId: number, funeralHomeId: number) {
  return db
    .select()
    .from(serviceSelectionsTable)
    .where(
      and(
        eq(serviceSelectionsTable.caseId, caseId),
        eq(serviceSelectionsTable.funeralHomeId, funeralHomeId),
      ),
    )
    .orderBy(
      asc(serviceSelectionsTable.kind),
      asc(serviceSelectionsTable.position),
      asc(serviceSelectionsTable.id),
    );
}

/** Append after whatever is already in that section. */
export async function nextPosition(
  caseId: number,
  funeralHomeId: number,
  kind: string,
): Promise<number> {
  const [row] = await db
    .select({ value: max(serviceSelectionsTable.position) })
    .from(serviceSelectionsTable)
    .where(
      and(
        eq(serviceSelectionsTable.caseId, caseId),
        eq(serviceSelectionsTable.funeralHomeId, funeralHomeId),
        eq(serviceSelectionsTable.kind, kind),
      ),
    );

  return (row?.value ?? -1) + 1;
}

async function loadSelection(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
): Promise<ServiceSelection> {
  const home = tenant(req);
  const id = parseId(rawId);

  const [row] = await db
    .select()
    .from(serviceSelectionsTable)
    .where(
      and(
        eq(serviceSelectionsTable.id, id),
        eq(serviceSelectionsTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  return requireRow(row, "That selection could not be found.");
}

router.get("/cases/:caseId/selections", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  res.json(await selectionsForCase(row.id, home.id));
});

router.post("/cases/:caseId/selections", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const values = parseBody(CreateSelectionBody, req.body);

  const value = values.value.trim();
  if (!value) throw badRequest("That can't be empty.");

  const [created] = await db
    .insert(serviceSelectionsTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      kind: values.kind,
      value,
      notes: values.notes ?? null,
      attribution: values.attribution ?? null,
      position: await nextPosition(row.id, home.id, values.kind),
    })
    .returning();

  res.status(201).json(created);
});

router.put("/selections/:selectionId", async (req, res) => {
  const existing = await loadSelection(req, req.params.selectionId);
  const { confirmed, ...values } = assertHasUpdates(
    parseBody(UpdateSelectionBody, req.body),
  );

  const [updated] = await db
    .update(serviceSelectionsTable)
    .set({
      ...values,
      ...(confirmed === undefined
        ? {}
        : { confirmedAt: confirmed ? new Date() : null }),
      updatedAt: new Date(),
    })
    .where(eq(serviceSelectionsTable.id, existing.id))
    .returning();

  res.json(updated);
});

router.delete("/selections/:selectionId", async (req, res) => {
  const existing = await loadSelection(req, req.params.selectionId);

  await db
    .delete(serviceSelectionsTable)
    .where(eq(serviceSelectionsTable.id, existing.id));

  res.status(204).end();
});

export default router;

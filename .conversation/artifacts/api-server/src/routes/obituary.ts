import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, obituaryDraftsTable, type ObituaryDraft } from "@workspace/db";
import {
  UpdateObituaryBody,
  ComposeObituaryBody,
} from "@workspace/api-zod";
import { assertHasUpdates, badRequest, parseBody, requireRow } from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import { composeObituary } from "../lib/obituary";
import { loadCase } from "./cases";

const router: IRouter = Router();

export async function loadDraft(
  caseId: number,
  funeralHomeId: number,
): Promise<ObituaryDraft> {
  const [row] = await db
    .select()
    .from(obituaryDraftsTable)
    .where(
      and(
        eq(obituaryDraftsTable.caseId, caseId),
        eq(obituaryDraftsTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  return requireRow(row, "That obituary could not be found.");
}

router.get("/cases/:caseId/obituary", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  res.json(await loadDraft(row.id, home.id));
});

/**
 * Staff edits. Unlike the family's endpoint this may write `draftText`
 * directly — and doing so stamps `draftEditedByStaff`, which is what stops a
 * later recompose throwing the director's rewrite away.
 */
router.put("/cases/:caseId/obituary", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const existing = await loadDraft(row.id, home.id);
  const values = assertHasUpdates(parseBody(UpdateObituaryBody, req.body));

  const touchedText = Object.prototype.hasOwnProperty.call(values, "draftText");

  const [updated] = await db
    .update(obituaryDraftsTable)
    .set({
      ...values,
      ...(touchedText ? { draftEditedByStaff: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(obituaryDraftsTable.id, existing.id))
    .returning();

  res.json(updated);
});

router.post("/cases/:caseId/obituary/compose", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const existing = await loadDraft(row.id, home.id);
  const { force } = parseBody(ComposeObituaryBody, req.body);

  if (existing.draftEditedByStaff !== null && !force) {
    throw badRequest(
      "This obituary has been edited by hand. Recomposing would replace those edits.",
    );
  }

  const [updated] = await db
    .update(obituaryDraftsTable)
    .set({
      draftText: composeObituary(existing),
      // A forced recompose starts the hand-edited clock again from clean.
      draftEditedByStaff: null,
      updatedAt: new Date(),
    })
    .where(eq(obituaryDraftsTable.id, existing.id))
    .returning();

  res.json(updated);
});

/**
 * Approve for print.
 *
 * After this the family's own endpoint refuses further edits, which is the
 * point: the text has gone to the printer, and a well-meaning relative
 * changing a date afterwards would produce cards that do not match the
 * service.
 */
router.post("/cases/:caseId/obituary/approve", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const existing = await loadDraft(row.id, home.id);

  if (!existing.draftText?.trim()) {
    throw badRequest("There is nothing to approve yet — the draft is empty.");
  }

  const [updated] = await db
    .update(obituaryDraftsTable)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedByUserId: user.id,
      updatedAt: new Date(),
    })
    .where(eq(obituaryDraftsTable.id, existing.id))
    .returning();

  res.json(updated);
});

export default router;

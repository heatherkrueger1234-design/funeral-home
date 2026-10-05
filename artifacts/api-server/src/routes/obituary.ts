import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, obituaryDraftsTable, type ObituaryDraft } from "@workspace/db";
import {
  UpdateObituaryBody,
  ComposeObituaryBody,
} from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  HttpError,
  parseBody,
  requireRow,
} from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import { composeObituary, obituaryHints } from "../lib/obituary";
import {
  isObituaryAiConfigured,
  ObituaryAiError,
  OBITUARY_AI_MODEL,
  suggestObituary,
} from "../lib/obituary-ai";
import { loadCase } from "./cases";
import { suggestionRateLimit } from "../middleware/rate-limit";

const router: IRouter = Router();

/** The draft as staff see it: the hints, and whether suggestions are on. */
export function toStaffObituaryJson(draft: ObituaryDraft) {
  return {
    ...draft,
    hints: obituaryHints(draft),
    aiAvailable: isObituaryAiConfigured(),
  };
}

const PRONOUNS = new Set(["she", "he", "they"]);

/** Null, or one of the three. Anything else is a mistake worth saying so. */
export function checkPronouns(values: { pronouns?: string | null }): void {
  if (values.pronouns != null && !PRONOUNS.has(values.pronouns)) {
    throw badRequest("Choose she, he or they — or leave it to use their name.");
  }
}

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
  res.json(toStaffObituaryJson(await loadDraft(row.id, home.id)));
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
  checkPronouns(values);

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

  res.json(toStaffObituaryJson(updated!));
});

router.post("/cases/:caseId/obituary/compose", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const existing = await loadDraft(row.id, home.id);
  const { force } = parseBody(ComposeObituaryBody, req.body);

  // A conflict rather than a bad request: nothing is wrong with what was
  // sent, it would just collide with somebody's rewrite. The console keys its
  // "that would replace your edits" wording off this status and nothing else.
  if (existing.draftEditedByStaff !== null && !force) {
    throw new HttpError(
      409,
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

  res.json(toStaffObituaryJson(updated!));
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

  res.json(toStaffObituaryJson(updated!));
});

/**
 * Take the sign-off back.
 *
 * Approval is a promise to the printer, and it is also the one thing that
 * locks the family out of editing. Without a way to undo it, the misspelt
 * grandchild spotted the night before the service had no route back into
 * the text at all. Reopening returns it to `submitted` — the director's
 * again — and clears the approval, so nothing further on still treats the
 * old words as final.
 */
router.post("/cases/:caseId/obituary/reopen", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const existing = await loadDraft(row.id, home.id);

  if (existing.status !== "approved") {
    throw new HttpError(
      409,
      "This obituary isn't approved, so it is already open for changes.",
    );
  }

  const [updated] = await db
    .update(obituaryDraftsTable)
    .set({
      status: "submitted",
      approvedAt: null,
      approvedByUserId: null,
      updatedAt: new Date(),
    })
    .where(eq(obituaryDraftsTable.id, existing.id))
    .returning();

  res.json(toStaffObituaryJson(updated!));
});

/**
 * Ask for a suggested rewrite.
 *
 * Staff only, off without a key, and only with `confirm: true`: the console
 * asks the director first, because this is the one place the family's words
 * leave for a third party. The suggestion is kept beside the draft; nothing
 * changes until `accept`.
 */
/*
 * Each suggestion is paid for by the platform, per token, and anybody can
 * register a home. So: a ceiling per home per hour (`suggestionRateLimit`),
 * one suggestion at a time per obituary, a capped prompt (`obituary-ai.ts`),
 * and a confirmed address — the same gate the public request form has.
 */
const suggesting = new Set<number>();

// Counted on the request for a suggestion only, not on accepting one.
router.use("/cases/:caseId/obituary/suggestion", (req, res, next) => {
  if (req.method === "POST" && req.path === "/") suggestionRateLimit(req, res, next);
  else next();
});
router.post("/cases/:caseId/obituary/suggestion", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const existing = await loadDraft(row.id, home.id);

  if (!isObituaryAiConfigured()) {
    throw new HttpError(409, "Suggested drafts are not switched on for this deployment.");
  }
  if (!user.emailVerified) {
    throw new HttpError(
      403,
      "Confirm your email address first — the link is in the email we sent when you joined.",
    );
  }
  if ((req.body as { confirm?: unknown })?.confirm !== true) {
    throw badRequest("Confirm that the family's notes may be sent for a suggestion.");
  }
  if (suggesting.has(existing.id)) {
    throw new HttpError(409, "A suggestion for this obituary is already being written.");
  }

  let text: string;
  suggesting.add(existing.id);
  try {
    text = await suggestObituary(existing);
  } catch (error) {
    if (error instanceof ObituaryAiError) throw new HttpError(502, error.message);
    throw error;
  } finally {
    suggesting.delete(existing.id);
  }

  req.log?.info(
    { caseId: row.id, model: OBITUARY_AI_MODEL, userId: user.id },
    "Obituary suggestion requested",
  );

  const [updated] = await db
    .update(obituaryDraftsTable)
    .set({
      aiSuggestion: text,
      aiSuggestedAt: new Date(),
      aiSuggestedByUserId: user.id,
      updatedAt: new Date(),
    })
    .where(eq(obituaryDraftsTable.id, existing.id))
    .returning();

  res.json(toStaffObituaryJson(updated!));
});

/** Take the suggestion as the draft. It then counts as the director's edit. */
router.post("/cases/:caseId/obituary/suggestion/accept", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const existing = await loadDraft(row.id, home.id);

  if (!existing.aiSuggestion?.trim()) {
    throw new HttpError(409, "There is no suggestion to use.");
  }
  if (existing.status === "approved") {
    throw new HttpError(409, "This obituary is approved for print. Reopen it first.");
  }

  const [updated] = await db
    .update(obituaryDraftsTable)
    .set({
      draftText: existing.aiSuggestion,
      draftEditedByStaff: new Date(),
      aiSuggestion: null,
      updatedAt: new Date(),
    })
    .where(eq(obituaryDraftsTable.id, existing.id))
    .returning();

  res.json(toStaffObituaryJson(updated!));
});

router.delete("/cases/:caseId/obituary/suggestion", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const existing = await loadDraft(row.id, home.id);

  const [updated] = await db
    .update(obituaryDraftsTable)
    .set({ aiSuggestion: null, updatedAt: new Date() })
    .where(eq(obituaryDraftsTable.id, existing.id))
    .returning();

  res.json(toStaffObituaryJson(updated!));
});

export default router;

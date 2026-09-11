import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  canOpenCases,
  casesTable,
  db,
  familyContactsTable,
  intakeRequestsTable,
  type IntakeRequest,
} from "@workspace/db";
import { GetIntakeRequestsQueryParams } from "@workspace/api-zod";
import { HttpError, parseQuery } from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import { toCaseJson } from "../lib/case-view";
import { mintLink, linkUrl } from "../lib/family-link";
import { markOnboarding } from "../lib/onboarding";
import { openCase } from "./cases";

const router: IRouter = Router();

/** What the director sees. Never the submitter's IP — that is for abuse. */
function toIntakeJson(row: IntakeRequest) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    requesterName: row.requesterName,
    requesterEmail: row.requesterEmail,
    requesterPhone: row.requesterPhone,
    relationship: row.relationship,
    subjectFirstName: row.subjectFirstName,
    subjectLastName: row.subjectLastName,
    subjectDisplayName: `${row.subjectFirstName} ${row.subjectLastName}`.trim(),
    dateOfDeath: row.dateOfDeath,
    note: row.note,
    caseId: row.caseId,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
  };
}

router.get("/intake-requests", async (req, res) => {
  const home = tenant(req);
  const { status } = parseQuery(GetIntakeRequestsQueryParams, req.query);

  const rows = await db
    .select()
    .from(intakeRequestsTable)
    .where(
      status
        ? and(
            eq(intakeRequestsTable.funeralHomeId, home.id),
            eq(intakeRequestsTable.status, status),
          )
        : eq(intakeRequestsTable.funeralHomeId, home.id),
    )
    // Oldest first, deliberately. This is a queue of people waiting, and the
    // one who has waited longest is the one to ring back.
    .orderBy(asc(intakeRequestsTable.createdAt));

  res.json(rows.map(toIntakeJson));
});

/**
 * Load a request that belongs to this home and has not been dealt with.
 *
 * Two directors opening the queue at once is the ordinary case, not the
 * exotic one, and the second of them must not be able to open a duplicate
 * case for the same death.
 */
async function loadPending(
  req: Parameters<typeof tenant>[0] & { params: { intakeId?: string } },
) {
  const home = tenant(req);
  const id = Number(req.params.intakeId);

  // `Number("")` is 0 and `Number("1e3")` is 1000; neither is an id somebody
  // clicked, and both would otherwise reach the database.
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(404, "No such request.");
  }

  const [row] = await db
    .select()
    .from(intakeRequestsTable)
    .where(
      and(
        eq(intakeRequestsTable.id, id),
        eq(intakeRequestsTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  if (!row) throw new HttpError(404, "No such request.");

  if (row.status !== "pending") {
    throw new HttpError(
      409,
      row.status === "accepted"
        ? "Somebody has already opened a case for this request."
        : "This request has already been dismissed.",
    );
  }

  return { home, row };
}

router.post("/intake-requests/:intakeId/accept", async (req, res) => {
  const user = currentUser(req);
  const { home, row } = await loadPending(req);

  if (!canOpenCases(home)) {
    throw new HttpError(
      402,
      home.subscriptionStatus === "trial"
        ? "Your trial has finished. Start a subscription to open new cases — everything already here stays available."
        : "This subscription has ended. Existing cases stay available; start a subscription to open new ones.",
    );
  }

  const created = await openCase(home.id, user.id, {
    kind: row.kind,
    decedentFirstName: row.subjectFirstName,
    decedentLastName: row.subjectLastName,
    dateOfDeath: row.dateOfDeath,
    // What they typed into the public form, kept where the director will read
    // it rather than left behind in a queue they will never open again.
    serviceNotes: row.note,
  });

  /*
   * The person who asked becomes the first family contact, so the link goes
   * straight back to them rather than to a name the director re-types.
   *
   * They are `next_of_kin` rather than a plain contributor: they came to the
   * home themselves, which is as close to a declaration of who is arranging
   * this as the product ever gets. On a pre-need file that person *is* the
   * subject, and the relationship they never typed stays empty — "self" is a
   * word this product would be putting in their mouth.
   */
  const link = mintLink();

  await db.insert(familyContactsTable).values({
    funeralHomeId: home.id,
    caseId: created.id,
    name: row.requesterName,
    email: row.requesterEmail,
    phone: row.requesterPhone,
    relationship: row.relationship,
    role: "next_of_kin",
    canInvite: true,
    tokenHash: link.tokenHash,
    expiresAt: link.expiresAt,
    invitedByUserId: user.id,
  });

  void markOnboarding(home.id, "family");

  // A case with a family member on it is live, exactly as it would be had the
  // director added them by hand. Leaving it at `intake` would hide it from the
  // list the director actually works from.
  const [live] = await db
    .update(casesTable)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(casesTable.id, created.id))
    .returning();

  /*
   * Only now mark it accepted, and only if it is still pending. Two directors
   * clicking at the same moment both reach here; the second changes no rows,
   * and finds out from the count rather than from a duplicate case appearing
   * in the list tomorrow.
   */
  const updated = await db
    .update(intakeRequestsTable)
    .set({
      status: "accepted",
      reviewedByUserId: user.id,
      reviewedAt: new Date(),
      caseId: created.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(intakeRequestsTable.id, row.id),
        eq(intakeRequestsTable.status, "pending"),
      ),
    )
    .returning();

  if (updated.length === 0) {
    throw new HttpError(
      409,
      "Somebody opened a case for this request a moment ago. Refresh the queue.",
    );
  }

  /*
   * The link is returned once, here, and never stored in a readable form —
   * the row holds only its digest. A director who loses it mints another from
   * the contact, which is the same path as "my sister forwarded it to someone
   * she shouldn't have".
   */
  res
    .status(201)
    .json({ ...toCaseJson(live ?? created), familyLink: linkUrl(link.token) });
});

router.post("/intake-requests/:intakeId/decline", async (req, res) => {
  const user = currentUser(req);
  const { row } = await loadPending(req);

  const [updated] = await db
    .update(intakeRequestsTable)
    .set({
      status: "declined",
      reviewedByUserId: user.id,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(intakeRequestsTable.id, row.id),
        eq(intakeRequestsTable.status, "pending"),
      ),
    )
    .returning();

  if (!updated) {
    throw new HttpError(409, "Somebody has already dealt with this request.");
  }

  // Nothing is sent to the person who asked. A home declining a bereaved
  // family's request by automated email would be worse than the dead end
  // this replaced; if it needs saying, it needs saying by a human.
  res.json(toIntakeJson(updated));
});

export default router;

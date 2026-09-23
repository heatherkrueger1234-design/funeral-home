import { Router, type IRouter } from "express";
import { and, isNull, asc, eq } from "drizzle-orm";
import {
  canOpenCases,
  cannotOpenCasesReason,
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
    throw new HttpError(402, cannotOpenCasesReason(home));
  }

  /*
   * Claim the request before opening anything.
   *
   * This used to open the case first and flip the request to accepted last,
   * with the conditional update at the end as the guard. That guard answered
   * the second director with a 409 -- after their case, their family contact
   * with a working link, and their billable funeral had all been written.
   * Two directors tapping Accept on the same request in the same second (the
   * queue is on every director's master page, so this is exactly when it
   * happens) left two cases for one death, one of them billed and carrying a
   * link nobody was ever shown. Claiming first means the loser is refused
   * before anything exists; a failure after the claim puts the request back
   * in the queue rather than losing it.
   */
  const [claimed] = await db
    .update(intakeRequestsTable)
    .set({
      status: "accepted",
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
    .returning({ id: intakeRequestsTable.id });

  if (!claimed) {
    throw new HttpError(
      409,
      "Somebody opened a case for this request a moment ago. Refresh the queue.",
    );
  }

  let created: Awaited<ReturnType<typeof openCase>>;
  let live: typeof created | undefined;
  let link: ReturnType<typeof mintLink>;

  try {
    created = await openCase(home, user.id, {
      kind: row.kind,
      decedentFirstName: row.subjectFirstName,
      decedentLastName: row.subjectLastName,
      dateOfDeath: row.dateOfDeath,
      // What they typed into the public form, kept where the director will read
      // it rather than left behind in a queue they will never open again.
      serviceNotes: row.note,
    });

    link = mintLink();

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

    await markOnboarding(home.id, "family");

    // A case with a family member on it is live, exactly as it would be had the
    // director added them by hand. Leaving it at `intake` would hide it from the
    // list the director actually works from.
    [live] = await db
      .update(casesTable)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(casesTable.id, created.id))
      .returning();

    await db
      .update(intakeRequestsTable)
      .set({ caseId: created.id, updatedAt: new Date() })
      .where(eq(intakeRequestsTable.id, row.id));
  } catch (error) {
    await db
      .update(intakeRequestsTable)
      .set({
        status: "pending",
        reviewedByUserId: null,
        reviewedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(intakeRequestsTable.id, row.id),
          isNull(intakeRequestsTable.caseId),
        ),
      );
    throw error;
  }

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

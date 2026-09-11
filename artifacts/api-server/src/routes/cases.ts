import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  db,
  casesTable,
  casePhotosTable,
  familyContactsTable,
  obituaryDraftsTable,
  usersTable,
  toPublicFamilyContact,
  toStaffSignature,
  MESSAGE_LOCK_DAYS,
  canOpenCases,
  type Case,
} from "@workspace/db";
import {
  CreateCaseBody,
  UpdateCaseBody,
  GetCasesQueryParams,
  ConvertCaseToAtNeedBody,
} from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  parseBody,
  parseId,
  parseQuery,
  requireRow,
} from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import { countsForCases, toCaseJson } from "../lib/case-view";
import { enrolCaseInAftercare } from "../lib/aftercare";
import { applyTemplateToCase, hasDeadlines } from "../lib/timeline";
import { markOnboarding } from "../lib/onboarding";
import { HttpError } from "../lib/http";

const router: IRouter = Router();

/**
 * Load a case, scoped to the signed-in home.
 *
 * Every handler in every staff file that takes a case id goes through here.
 * The id in the URL is attacker-controlled; the home id is not, and the
 * `and()` is what makes naming another home's case id return a 404 rather
 * than their family's photographs.
 */
async function loadCase(req: Parameters<typeof tenant>[0], rawId: string | undefined): Promise<Case> {
  const home = tenant(req);
  const id = parseId(rawId);

  const [row] = await db
    .select()
    .from(casesTable)
    .where(and(eq(casesTable.id, id), eq(casesTable.funeralHomeId, home.id)))
    .limit(1);

  return requireRow(row, "That case could not be found.");
}

export { loadCase };

router.get("/cases", async (req, res) => {
  const home = tenant(req);
  const query = parseQuery(GetCasesQueryParams, req.query);

  const search = query.search?.trim();

  const rows = await db
    .select()
    .from(casesTable)
    .where(
      and(
        eq(casesTable.funeralHomeId, home.id),
        query.status ? eq(casesTable.status, query.status) : undefined,
        // A director searches for "Hale", not for a case number, and they may
        // have recorded her as Margaret while the family calls her Peggy --
        // so all three name columns are matched.
        search
          ? or(
              ilike(casesTable.decedentLastName, `%${search}%`),
              ilike(casesTable.decedentFirstName, `%${search}%`),
              ilike(casesTable.decedentPreferredName, `%${search}%`),
            )
          : undefined,
      ),
    )
    // Soonest service first, with cases that have no date yet at the top:
    // an undated case is one nobody has scheduled, which is the one most
    // likely to be forgotten.
    // `asc()` around raw SQL emits "nulls first asc", which Postgres rejects,
    // so the whole ordering term is written out here.
    .orderBy(
      sql`${casesTable.serviceAt} asc nulls first`,
      desc(casesTable.createdAt),
    )
    /*
     * Bounded, because this is otherwise every case the home has ever had.
     * A home three years in has hundreds of closed ones, and the counts below
     * are five aggregate queries over whatever this returns. The list is
     * ordered by what needs attention first, so the tail is the part nobody
     * scrolls to -- searching is how you reach an old case.
     */
    .limit(query.limit ?? 100);

  const counts = await countsForCases(
    rows.map((row) => row.id),
    home.id,
  );

  res.json(
    rows.map((row) => ({
      ...toCaseJson(row),
      ...counts.get(row.id)!,
    })),
  );
});

router.post("/cases", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);

  /*
   * The only place the subscription gates anything.
   *
   * Opening a *new* case is refused when a trial has run out or a
   * subscription was cancelled. Everything else keeps working, on purpose:
   * a family part-way through uploading photographs of their mother must not
   * lose access because the home changed billing plans, and a director must
   * not be locked out of Thursday's funeral because a card expired --
   * `past_due` still opens cases while Stripe chases the payment.
   */
  if (!canOpenCases(home)) {
    throw new HttpError(
      402,
      home.subscriptionStatus === "trial"
        ? "Your trial has finished. Start a subscription to open new cases — everything already here stays available."
        : "This subscription has ended. Existing cases stay available; start a subscription to open new ones.",
    );
  }

  const values = parseBody(CreateCaseBody, req.body);

  if (values.leadDirectorId != null) {
    await assertStaffBelongsHere(values.leadDirectorId, home.id);
  }

  const created = await openCase(home.id, user.id, values);

  res.status(201).json(toCaseJson(created));
});

/**
 * Everything that has to happen for a case to exist properly.
 *
 * Extracted because there are now two doors into it — a director opening one
 * directly, and a director accepting a request that came through the home's
 * public page — and the second must not be a thinner version of the first.
 * A case created without its obituary row, or without the standard schedule,
 * is a case that quietly behaves differently from every other one for the
 * rest of its life.
 */
export async function openCase(
  funeralHomeId: number,
  userId: number,
  values: Partial<typeof casesTable.$inferInsert> & {
    decedentFirstName: string;
    decedentLastName: string;
  },
): Promise<Case> {
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(casesTable)
      .values({
        ...values,
        funeralHomeId,
        createdByUserId: userId,
      })
      .returning();

    // The obituary row is created with the case rather than lazily on first
    // visit, so that "what stage is the obituary at" is answerable for every
    // case without a null check in five different places.
    await tx.insert(obituaryDraftsTable).values({
      funeralHomeId,
      caseId: row!.id,
      fullName: `${row!.decedentFirstName} ${row!.decedentLastName}`.trim(),
    });

    return row!;
  });

  // A director who already knows the funeral time when they open the case
  // should get the schedule straight away, exactly as they would if they
  // added the date a day later.
  //
  // Not for a pre-need file: the standard schedule counts backwards from a
  // service date, and there is no service. Building one would put a list of
  // overdue funeral tasks in front of somebody who is perfectly well.
  if (created.serviceAt !== null && created.kind !== "pre_need") {
    await applyTemplateToCase(created);
  }

  void markOnboarding(funeralHomeId, "case");

  return created;
}

/** A lead director has to actually work here. */
async function assertStaffBelongsHere(userId: number, funeralHomeId: number) {
  const [staff] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(eq(usersTable.id, userId), eq(usersTable.funeralHomeId, funeralHomeId)),
    )
    .limit(1);

  if (!staff) throw badRequest("That director does not work at this home.");
}

router.get("/cases/:caseId", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  const [counts, contacts, lead] = await Promise.all([
    countsForCases([row.id], home.id),
    db
      .select()
      .from(familyContactsTable)
      .where(eq(familyContactsTable.caseId, row.id))
      .orderBy(asc(familyContactsTable.createdAt)),
    row.leadDirectorId === null
      ? Promise.resolve([])
      : db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, row.leadDirectorId))
          .limit(1),
  ]);

  res.json({
    ...toCaseJson(row),
    ...counts.get(row.id)!,
    leadDirector: lead[0] ? toStaffSignature(lead[0]) : null,
    contacts: contacts.map(toPublicFamilyContact),
  });
});

router.put("/cases/:caseId", async (req, res) => {
  const home = tenant(req);
  const existing = await loadCase(req, req.params.caseId);
  const values = assertHasUpdates(parseBody(UpdateCaseBody, req.body));

  if (values.leadDirectorId != null) {
    await assertStaffBelongsHere(values.leadDirectorId, home.id);
  }

  // The portrait has to be a photograph on this case. Without the check, a
  // director could point one family's portrait at another family's photo id.
  if (values.portraitPhotoId != null) {
    await assertPhotoOnCase(values.portraitPhotoId, existing.id, home.id);
  }

  const [updated] = await db
    .update(casesTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(casesTable.id, existing.id))
    .returning();

  /*
   * The moment that makes the timeline actually happen.
   *
   * A director sets the service date once they have it, and that is the last
   * point at which anybody was going to think about deadlines. Building the
   * schedule here means the family is told when their clothing is due without
   * anyone remembering to tell them.
   *
   * Only when the case has no timeline yet, so this cannot trample a schedule
   * somebody has already adjusted by hand. Rebuilding after a date change is
   * an explicit button.
   */
  if (
    updated!.serviceAt !== null &&
    existing.serviceAt === null &&
    !(await hasDeadlines(updated!.id))
  ) {
    await applyTemplateToCase(updated!);
  }

  res.json(toCaseJson(updated!));
});

async function assertPhotoOnCase(
  photoId: number,
  caseId: number,
  funeralHomeId: number,
) {
  const [photo] = await db
    .select({ id: casePhotosTable.id })
    .from(casePhotosTable)
    .where(
      and(
        eq(casePhotosTable.id, photoId),
        eq(casePhotosTable.caseId, caseId),
        eq(casePhotosTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  if (!photo) throw badRequest("That photograph is not on this case.");
}

/**
 * Close the case.
 *
 * Three things happen, and the third is the one the home is paying for:
 * the case stops being active, the chat is given a date it locks (a
 * fortnight past the service, so nobody is fielding logistics in March about
 * a funeral in January), and every family contact with an address is enrolled
 * — pending their consent — in the branded grief check-ins.
 *
 * Idempotent: closing an already-closed case returns it unchanged rather
 * than moving the lock date and re-enrolling everyone.
 */
/**
 * The person this pre-need file was for has died.
 *
 * This is the single moment that justifies pre-need and at-need being one
 * table rather than two products. Everything they chose while well is already
 * here — the photographs, the obituary in their own words, the hymns, who
 * carries them — so on the day it is hardest to ask, nobody is asked. A
 * separate pre-need system that has to be copied across at exactly this
 * moment is how everyone else does it, and is why the copying does not
 * happen.
 */
router.post("/cases/:caseId/at-need", async (req, res) => {
  const existing = await loadCase(req, req.params.caseId);

  if (existing.kind !== "pre_need") {
    throw new HttpError(
      409,
      "This is already an at-need case.",
    );
  }

  const body = parseBody(ConvertCaseToAtNeedBody, req.body);

  const [converted] = await db
    .update(casesTable)
    .set({
      kind: "at_need",
      dateOfDeath: body.dateOfDeath,
      ...(body.serviceAt === undefined ? {} : { serviceAt: body.serviceAt }),
      updatedAt: new Date(),
    })
    .where(eq(casesTable.id, existing.id))
    .returning();

  /*
   * Now build the schedule this file deliberately never had. A pre-need file
   * gets no timeline because the standard schedule counts backwards from a
   * service, and putting a list of overdue funeral tasks in front of somebody
   * who is perfectly well would be grotesque. That objection has just stopped
   * applying.
   */
  if (converted!.serviceAt !== null && !(await hasDeadlines(converted!.id))) {
    await applyTemplateToCase(converted!);
  }

  res.json(toCaseJson(converted!));
});

router.post("/cases/:caseId/close", async (req, res) => {
  const home = tenant(req);
  const existing = await loadCase(req, req.params.caseId);

  if (existing.status === "closed") {
    const counts = await countsForCases([existing.id], home.id);
    res.json({
      ...toCaseJson(existing),
      ...counts.get(existing.id)!,
      leadDirector: null,
      contacts: [],
    });
    return;
  }

  const now = new Date();
  // Measured from the service where there is one. A case closed without a
  // service date still gets a fortnight, counted from today.
  const from = existing.serviceAt ?? now;
  const lockAt = new Date(from.getTime() + MESSAGE_LOCK_DAYS * 24 * 60 * 60 * 1000);

  const [closed] = await db
    .update(casesTable)
    .set({ status: "closed", closedAt: now, messagesLockAt: lockAt, updatedAt: now })
    .where(eq(casesTable.id, existing.id))
    .returning();

  /*
   * Never for a pre-need file.
   *
   * Aftercare is grief support: "thinking of you, a month on", signed in the
   * home's name. Closing a pre-need file means the person has finished
   * writing down what they want, and they are alive — sending them a
   * bereavement check-in about themselves would be the worst thing this
   * product is capable of doing. The kind check comes first, before the
   * home's own setting, because no home setting should be able to turn this
   * on for someone who has not died.
   */
  if (closed!.kind !== "pre_need" && home.aftercareEnabled) {
    await enrolCaseInAftercare(closed!, home, now);
  }

  const [counts, contacts] = await Promise.all([
    countsForCases([closed!.id], home.id),
    db
      .select()
      .from(familyContactsTable)
      .where(eq(familyContactsTable.caseId, closed!.id))
      .orderBy(asc(familyContactsTable.createdAt)),
  ]);

  res.json({
    ...toCaseJson(closed!),
    ...counts.get(closed!.id)!,
    leadDirector: null,
    contacts: contacts.map(toPublicFamilyContact),
  });
});

export default router;

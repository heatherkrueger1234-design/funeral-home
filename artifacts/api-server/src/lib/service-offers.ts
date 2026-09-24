import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  db,
  caseServiceOffersTable,
  casesTable,
  familyContactsTable,
  type Case,
  type CaseServiceOffer,
} from "@workspace/db";
import { HttpError } from "./http";
import { applyTemplateToCase, type ApplyResult } from "./timeline";

/**
 * Offering a family two or three times, and what happens when they pick one.
 *
 * Both sides come through `chooseOffer` — the family tapping it in the portal
 * and the director recording the telephone call they got instead. They must
 * not be two code paths: the second one is the one that gets written in a
 * hurry, and it is the one that would forget to build the timeline.
 */

export type OfferJson = ReturnType<typeof toOfferJson>;

/**
 * `chosenByName` is the family member who answered, and is null when the home
 * recorded the choice on their behalf — which is what a telephone call looks
 * like from here. Crediting a daughter with a tap she never made would be a
 * small lie in a record a director may later have to rely on.
 */
export function toOfferJson(
  row: CaseServiceOffer,
  chosenByName: string | null = null,
) {
  return {
    id: row.id,
    caseId: row.caseId,
    startsAt: row.startsAt,
    location: row.location,
    note: row.note,
    position: row.position,
    chosenAt: row.chosenAt,
    chosenByName: row.chosenAt === null ? null : chosenByName,
  };
}

/**
 * Every offer on a case, soonest first, with the name of whoever answered.
 *
 * Ordered by time rather than by `position` on purpose: the home enters them
 * in whatever order they thought of them, and a family reading three dates
 * out of order has to sort them in their head on the worst week of their
 * life.
 */
export async function offersForCase(caseId: number): Promise<OfferJson[]> {
  const rows = await db
    .select({
      offer: caseServiceOffersTable,
      contactName: familyContactsTable.name,
    })
    .from(caseServiceOffersTable)
    .leftJoin(
      familyContactsTable,
      eq(familyContactsTable.id, caseServiceOffersTable.chosenByContactId),
    )
    .where(eq(caseServiceOffersTable.caseId, caseId))
    .orderBy(
      asc(caseServiceOffersTable.startsAt),
      asc(caseServiceOffersTable.id),
    );

  return rows.map(({ offer, contactName }) => toOfferJson(offer, contactName));
}

/** The chosen one, if the family has answered. */
export async function chosenOffer(
  caseId: number,
): Promise<CaseServiceOffer | undefined> {
  const [row] = await db
    .select()
    .from(caseServiceOffersTable)
    .where(
      and(
        eq(caseServiceOffersTable.caseId, caseId),
        isNotNull(caseServiceOffersTable.chosenAt),
      ),
    )
    .limit(1);

  return row;
}

/**
 * Whether this family still has a question in front of them.
 *
 * Three things have to be true, and the third is the one that was missed
 * first time round. Times were offered; nobody picked one; and *the date is
 * still open* — because the ordinary ending is not a tap at all. The family
 * rings, the director types the time onto the case, and the offers sit there
 * unanswered forever. Without the `serviceAt` clause the hub goes on asking a
 * family to choose a date that is already printed on their order of service,
 * and the dashboard goes on reporting them as a family who has not got back
 * to you.
 *
 * A closed case is settled by definition, whatever its columns say.
 *
 * This is the definition. `casesAwaitingChoice` below is the same sentence in
 * SQL, and the two must not drift: the director's tile and the family's hub
 * disagreeing about whether anything is outstanding is worse than neither
 * saying anything.
 */
export function isAwaitingChoice(
  row: Pick<Case, "status" | "serviceAt">,
  openOffers: number,
  chosen: CaseServiceOffer | undefined,
): boolean {
  if (row.status === "closed") return false;
  if (row.serviceAt !== null) return false;
  if (chosen !== undefined) return false;

  return openOffers > 0;
}

/**
 * Cases where the home has asked and nobody has answered.
 *
 * One row per case rather than per offer — a case with three unanswered
 * times is one family who has not got back to you, not three. The predicate
 * is `isAwaitingChoice` above, in SQL.
 */
export async function casesAwaitingChoice(
  funeralHomeId: number,
): Promise<number[]> {
  const rows = await db
    .select({ caseId: caseServiceOffersTable.caseId })
    .from(caseServiceOffersTable)
    .innerJoin(casesTable, eq(casesTable.id, caseServiceOffersTable.caseId))
    .where(
      and(
        eq(caseServiceOffersTable.funeralHomeId, funeralHomeId),
        ne(casesTable.status, "closed"),
        isNull(casesTable.serviceAt),
      ),
    )
    .groupBy(caseServiceOffersTable.caseId)
    .having(
      sql`count(*) filter (where ${caseServiceOffersTable.chosenAt} is not null) = 0`,
    );

  return rows.map((row) => row.caseId);
}

export type ChooseResult = {
  offer: CaseServiceOffer;
  serviceAt: Date;
  schedule: ApplyResult;
};

/** Postgres' unique-violation SQLSTATE, wherever Drizzle has buried it. */
function isUniqueViolation(err: unknown): boolean {
  for (let current = err, depth = 0; current && depth < 4; depth += 1) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/**
 * Mark exactly one offer chosen, or nothing.
 *
 * Belt and braces, and both are needed. The `not exists` refuses the second
 * answer in the ordinary case. The caught unique violation covers the narrow
 * one it cannot: under READ COMMITTED, two transactions starting at the same
 * instant both see no chosen row, and it is the partial unique index on
 * `case_id where chosen_at is not null` that stops them both succeeding.
 * Without the catch that arrives as a 500 on a brother and a sister tapping
 * at once, which is a real Tuesday rather than a thought experiment.
 */
async function claimOffer(
  offerId: number,
  caseId: number,
  contactId: number | null,
  now: Date,
): Promise<CaseServiceOffer | undefined> {
  try {
    const [claimed] = await db
      .update(caseServiceOffersTable)
      .set({ chosenAt: now, chosenByContactId: contactId, updatedAt: now })
      .where(
        and(
          eq(caseServiceOffersTable.id, offerId),
          sql`not exists (
            select 1 from ${caseServiceOffersTable} other
            where other.case_id = ${caseId} and other.chosen_at is not null
          )`,
        ),
      )
      .returning();

    return claimed;
  } catch (err) {
    if (isUniqueViolation(err)) return undefined;
    throw err;
  }
}

/**
 * Settle the date.
 *
 * Three things happen together or not at all: the offer is marked chosen, the
 * case gets its service date, and the home's standard schedule is applied to
 * it. The third is the point of the whole feature — a family who answers at
 * eleven at night has a dated timeline at eleven at night, without waiting
 * for a director to press anything in the morning.
 *
 * The first write is the one that guards against a second answer. It is
 * conditional on no offer having been chosen yet, so two people in the same
 * kitchen tapping two different times produce one funeral: the loser's update
 * matches no rows and is reported as a conflict, rather than quietly
 * overwriting the service date the winner just set.
 */
export async function chooseOffer(
  row: Case,
  offerId: number,
  by: { contactId: number | null },
  now = new Date(),
): Promise<ChooseResult> {
  const [offer] = await db
    .select()
    .from(caseServiceOffersTable)
    .where(
      and(
        eq(caseServiceOffersTable.id, offerId),
        eq(caseServiceOffersTable.caseId, row.id),
      ),
    )
    .limit(1);

  if (!offer) {
    throw new HttpError(404, "That time is no longer being offered.");
  }

  const claimed = await claimOffer(offer.id, row.id, by.contactId, now);

  if (!claimed) {
    throw new HttpError(
      409,
      "A time has already been chosen for this service. Please call the funeral home if it needs to change.",
    );
  }

  const [updatedCase] = await db
    .update(casesTable)
    .set({
      serviceAt: claimed.startsAt,
      // Only when the option carried one. An offer without a location is a
      // different time at the same place, and blanking what the case already
      // says would lose the venue the director typed in last week.
      ...(claimed.location === null ? {} : { serviceLocation: claimed.location }),
      updatedAt: now,
    })
    .where(eq(casesTable.id, row.id))
    .returning();

  const schedule = await applyTemplateToCase(updatedCase ?? row, now);

  return { offer: claimed, serviceAt: claimed.startsAt, schedule };
}

/**
 * Refuse to add or withdraw an option once the family has answered.
 *
 * A list that changes after an answer is a list somebody will answer twice,
 * and withdrawing the chosen one would leave a case whose service date
 * traces to nothing while the family believes the matter is settled.
 */
export async function assertUnanswered(caseId: number): Promise<void> {
  const chosen = await chosenOffer(caseId);

  if (chosen) {
    throw new HttpError(
      409,
      "The family has already chosen a time. Change the service date on the case instead.",
    );
  }
}

/** Offers still open on a case, for the counts a dashboard shows. */
export async function openOfferCount(caseId: number): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(caseServiceOffersTable)
    .where(
      and(
        eq(caseServiceOffersTable.caseId, caseId),
        isNull(caseServiceOffersTable.chosenAt),
      ),
    );

  return row?.value ?? 0;
}

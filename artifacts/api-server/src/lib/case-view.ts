import { and, count, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  casesTable,
  casePhotosTable,
  caseDeadlinesTable,
  caseMessagesTable,
  familyContactsTable,
  obituaryDraftsTable,
  decedentDisplayName,
  type Case,
} from "@workspace/db";

/**
 * The counts that turn a list of cases into a worklist.
 *
 * A director opening this product at 8am is not asking "what cases exist" —
 * they know. They are asking which family is behind, and on what. So the
 * list carries the four numbers that answer it: photographs in, messages
 * waiting for a reply, things overdue, and where the obituary has got to.
 *
 * Computed in one grouped pass per case set rather than per row, because the
 * obvious implementation is a query inside a loop and it is only obviously
 * fine until a home has three hundred closed cases.
 */

export type CaseCounts = {
  photoCount: number;
  unreadFamilyMessages: number;
  outstandingDeadlines: number;
  obituaryStatus: "family_draft" | "submitted" | "approved";
  nextOfKinName: string | null;
};

export async function countsForCases(
  caseIds: number[],
  funeralHomeId: number,
  now = new Date(),
): Promise<Map<number, CaseCounts>> {
  const result = new Map<number, CaseCounts>();

  if (caseIds.length === 0) return result;

  for (const id of caseIds) {
    result.set(id, {
      photoCount: 0,
      unreadFamilyMessages: 0,
      outstandingDeadlines: 0,
      obituaryStatus: "family_draft",
      nextOfKinName: null,
    });
  }

  const inCases = inArray(casesTable.id, caseIds);

  const [photos, unread, overdue, obituaries, kin] = await Promise.all([
    db
      .select({ caseId: casePhotosTable.caseId, value: count() })
      .from(casePhotosTable)
      .innerJoin(casesTable, eq(casesTable.id, casePhotosTable.caseId))
      .where(and(eq(casePhotosTable.funeralHomeId, funeralHomeId), inCases))
      .groupBy(casePhotosTable.caseId),

    // "Unread" means written by the family and not yet read by the home.
    // A message from the home is never unread to the home.
    db
      .select({ caseId: caseMessagesTable.caseId, value: count() })
      .from(caseMessagesTable)
      .innerJoin(casesTable, eq(casesTable.id, caseMessagesTable.caseId))
      .where(
        and(
          eq(caseMessagesTable.funeralHomeId, funeralHomeId),
          isNull(caseMessagesTable.authorUserId),
          isNull(caseMessagesTable.readAt),
          inCases,
        ),
      )
      .groupBy(caseMessagesTable.caseId),

    // Outstanding means due, not done, and not an event. The funeral itself
    // is on the timeline and is never something anybody is behind on.
    db
      .select({ caseId: caseDeadlinesTable.caseId, value: count() })
      .from(caseDeadlinesTable)
      .innerJoin(casesTable, eq(casesTable.id, caseDeadlinesTable.caseId))
      .where(
        and(
          eq(caseDeadlinesTable.funeralHomeId, funeralHomeId),
          isNull(caseDeadlinesTable.completedAt),
          eq(caseDeadlinesTable.isEvent, false),
          inCases,
        ),
      )
      .groupBy(caseDeadlinesTable.caseId),

    db
      .select({
        caseId: obituaryDraftsTable.caseId,
        status: obituaryDraftsTable.status,
      })
      .from(obituaryDraftsTable)
      .innerJoin(casesTable, eq(casesTable.id, obituaryDraftsTable.caseId))
      .where(and(eq(obituaryDraftsTable.funeralHomeId, funeralHomeId), inCases)),

    db
      .select({
        caseId: familyContactsTable.caseId,
        name: familyContactsTable.name,
      })
      .from(familyContactsTable)
      .innerJoin(casesTable, eq(casesTable.id, familyContactsTable.caseId))
      .where(
        and(
          eq(familyContactsTable.funeralHomeId, funeralHomeId),
          eq(familyContactsTable.role, "next_of_kin"),
          inCases,
        ),
      ),
  ]);

  for (const row of photos) {
    const entry = result.get(row.caseId);
    if (entry) entry.photoCount = Number(row.value);
  }
  for (const row of unread) {
    const entry = result.get(row.caseId);
    if (entry) entry.unreadFamilyMessages = Number(row.value);
  }
  for (const row of overdue) {
    const entry = result.get(row.caseId);
    if (entry) entry.outstandingDeadlines = Number(row.value);
  }
  for (const row of obituaries) {
    const entry = result.get(row.caseId);
    if (entry) {
      entry.obituaryStatus = row.status as CaseCounts["obituaryStatus"];
    }
  }
  for (const row of kin) {
    const entry = result.get(row.caseId);
    if (entry && entry.nextOfKinName === null) entry.nextOfKinName = row.name;
  }

  return result;
}

/** A case row as the API describes it, with the computed display name. */
export function toCaseJson(row: Case) {
  return { ...row, displayName: decedentDisplayName(row) };
}

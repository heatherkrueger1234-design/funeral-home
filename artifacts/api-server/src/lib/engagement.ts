import { and, count, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  aftercareEnrollmentsTable,
  appointmentSlotsTable,
  caseDeadlinesTable,
  caseMessagesTable,
  casePhotosTable,
  casesTable,
  familyContactsTable,
  merchandiseSelectionsTable,
  obituaryDraftsTable,
  vitalStatisticsTable,
  type Case,
} from "@workspace/db";

/**
 * Counting, in one place, for two people who are asking different questions.
 *
 * A **director** asks "did that text land, and is this family stuck?" The
 * answer is about one case and one week, and it is only useful if it names a
 * person and a next move.
 *
 * The **platform admin** asks "are these homes getting value from the thing
 * they pay for?" The answer is about a home over months, and it is only
 * useful if the same number means the same thing in every home.
 *
 * Both live here rather than in the screens that show them, because the
 * moment a second file starts counting photographs the two answers drift and
 * nobody can tell which is wrong. Component 2's console renders
 * `engagementForHomes`; the director console renders `engagementForCase`.
 *
 * One rule about all of it: **nothing here ranks a family.** There is no
 * score, no percentage, no league table, and no column that could become one.
 * A family that has not uploaded photographs of their mother is not failing
 * at anything — they are three days bereaved. What the director gets is a
 * sentence describing what has not happened yet, so they can pick up the
 * telephone. See the craft standard in `TEAM-SPLIT.md`.
 */

/* --------------------------------------------------- per home, for C2 -- */

/**
 * A home's totals.
 *
 * The first nine fields are exactly the shape Component 2's console already
 * renders, and they keep their names for that reason — `familyLinksOpened`
 * next to `familyLinksCreated` is a fraction on the overview screen, and
 * renaming either would be a change to a screen this component does not own.
 * Anything added goes on the end.
 */
export type HomeEngagement = {
  casesOpened: number;
  casesActive: number;
  familyLinksCreated: number;
  familyLinksOpened: number;
  photographs: number;
  aftercareEnrolled: number;
  aftercareConsented: number;
  aftercareDeclined: number;
  aftercareUnsubscribed: number;

  /** People on the family's side who have actually been in. */
  familiesContributing: number;
  /** Messages a family sent. The half of the thread nobody can fake. */
  messagesFromFamily: number;
  /** Death certificate data handed over by the family and submitted. */
  formsCompleted: number;
  obituariesApproved: number;
  /** Selections a family confirmed through the home's storefront. */
  storefrontSelections: number;
  /** Times the home offered, and times a family took one. */
  slotsOffered: number;
  slotsTaken: number;
};

function blankHomeEngagement(): HomeEngagement {
  return {
    casesOpened: 0,
    casesActive: 0,
    familyLinksCreated: 0,
    familyLinksOpened: 0,
    photographs: 0,
    aftercareEnrolled: 0,
    aftercareConsented: 0,
    aftercareDeclined: 0,
    aftercareUnsubscribed: 0,
    familiesContributing: 0,
    messagesFromFamily: 0,
    formsCompleted: 0,
    obituariesApproved: 0,
    storefrontSelections: 0,
    slotsOffered: 0,
    slotsTaken: 0,
  };
}

export function emptyEngagement(): HomeEngagement {
  return blankHomeEngagement();
}

/**
 * Add one home's totals into another's, for the platform-wide row.
 *
 * Written as a loop over the keys rather than field by field, so that adding
 * a metric above cannot silently leave it out of the total that Component 2
 * prints across the top of its overview.
 */
export function addEngagement(
  into: HomeEngagement,
  from: HomeEngagement,
): HomeEngagement {
  for (const key of Object.keys(into) as (keyof HomeEngagement)[]) {
    into[key] += from[key];
  }
  return into;
}

/**
 * Totals for a set of homes, in one pass per table.
 *
 * Grouped queries rather than a query per home: the platform overview asks
 * for every customer at once, and a hundred homes must not be a hundred
 * round trips. Every query is scoped by `inArray` on the caller's own list,
 * so this can never widen to homes the caller did not name.
 */
export async function engagementForHomes(
  homeIds: readonly number[],
): Promise<Map<number, HomeEngagement>> {
  const byHome = new Map<number, HomeEngagement>(
    homeIds.map((id) => [id, blankHomeEngagement()]),
  );

  if (homeIds.length === 0) return byHome;

  const at = (id: number) => byHome.get(id) ?? blankHomeEngagement();

  const cases = await db
    .select({
      homeId: casesTable.funeralHomeId,
      total: count(),
      active:
        sql<number>`count(*) filter (where ${casesTable.status} <> 'closed')`.mapWith(
          Number,
        ),
    })
    .from(casesTable)
    .where(inArray(casesTable.funeralHomeId, homeIds))
    .groupBy(casesTable.funeralHomeId);

  for (const row of cases) {
    const entry = at(row.homeId);
    entry.casesOpened = row.total;
    entry.casesActive = row.active;
  }

  const contacts = await db
    .select({
      homeId: familyContactsTable.funeralHomeId,
      created: count(),
      opened:
        sql<number>`count(*) filter (where ${familyContactsTable.firstSeenAt} is not null)`.mapWith(
          Number,
        ),
      /*
       * "Contributing" is deliberately the weakest possible definition: a
       * contact who has opened their link at least once. Anything stronger —
       * a photograph, a message — measures how bereaved somebody had the
       * energy to be that week, which is not a thing to count.
       */
      contributing:
        sql<number>`count(*) filter (where ${familyContactsTable.lastSeenAt} is not null)`.mapWith(
          Number,
        ),
    })
    .from(familyContactsTable)
    .where(inArray(familyContactsTable.funeralHomeId, homeIds))
    .groupBy(familyContactsTable.funeralHomeId);

  for (const row of contacts) {
    const entry = at(row.homeId);
    entry.familyLinksCreated = row.created;
    entry.familyLinksOpened = row.opened;
    entry.familiesContributing = row.contributing;
  }

  const photos = await db
    .select({ homeId: casePhotosTable.funeralHomeId, total: count() })
    .from(casePhotosTable)
    .where(inArray(casePhotosTable.funeralHomeId, homeIds))
    .groupBy(casePhotosTable.funeralHomeId);

  for (const row of photos) {
    at(row.homeId).photographs = row.total;
  }

  const aftercare = await db
    .select({
      homeId: aftercareEnrollmentsTable.funeralHomeId,
      enrolled: count(),
      consented:
        sql<number>`count(*) filter (where ${aftercareEnrollmentsTable.consentedAt} is not null)`.mapWith(
          Number,
        ),
      unsubscribed:
        sql<number>`count(*) filter (where ${aftercareEnrollmentsTable.unsubscribedAt} is not null)`.mapWith(
          Number,
        ),
    })
    .from(aftercareEnrollmentsTable)
    .where(inArray(aftercareEnrollmentsTable.funeralHomeId, homeIds))
    .groupBy(aftercareEnrollmentsTable.funeralHomeId);

  for (const row of aftercare) {
    const entry = at(row.homeId);
    entry.aftercareEnrolled = row.enrolled;
    entry.aftercareConsented = row.consented;
    entry.aftercareUnsubscribed = row.unsubscribed;
    /*
     * Enrolled, never said yes, and has not asked to stop. Named `declined`
     * because that is the column Component 2 already renders, but it is
     * mostly the family that simply did not answer — which is most of them,
     * and is not a failure of anything.
     */
    entry.aftercareDeclined = Math.max(
      0,
      row.enrolled - row.consented - row.unsubscribed,
    );
  }

  const messages = await db
    .select({
      homeId: caseMessagesTable.funeralHomeId,
      total:
        sql<number>`count(*) filter (where ${caseMessagesTable.authorContactId} is not null)`.mapWith(
          Number,
        ),
    })
    .from(caseMessagesTable)
    .where(inArray(caseMessagesTable.funeralHomeId, homeIds))
    .groupBy(caseMessagesTable.funeralHomeId);

  for (const row of messages) {
    at(row.homeId).messagesFromFamily = row.total;
  }

  const vitals = await db
    .select({
      homeId: vitalStatisticsTable.funeralHomeId,
      total:
        sql<number>`count(*) filter (where ${vitalStatisticsTable.submittedAt} is not null)`.mapWith(
          Number,
        ),
    })
    .from(vitalStatisticsTable)
    .where(inArray(vitalStatisticsTable.funeralHomeId, homeIds))
    .groupBy(vitalStatisticsTable.funeralHomeId);

  for (const row of vitals) {
    at(row.homeId).formsCompleted = row.total;
  }

  const obituaries = await db
    .select({
      homeId: obituaryDraftsTable.funeralHomeId,
      total:
        sql<number>`count(*) filter (where ${obituaryDraftsTable.status} = 'approved')`.mapWith(
          Number,
        ),
    })
    .from(obituaryDraftsTable)
    .where(inArray(obituaryDraftsTable.funeralHomeId, homeIds))
    .groupBy(obituaryDraftsTable.funeralHomeId);

  for (const row of obituaries) {
    at(row.homeId).obituariesApproved = row.total;
  }

  const selections = await db
    .select({
      homeId: merchandiseSelectionsTable.funeralHomeId,
      total:
        sql<number>`count(*) filter (where ${merchandiseSelectionsTable.status} = 'confirmed')`.mapWith(
          Number,
        ),
    })
    .from(merchandiseSelectionsTable)
    .where(inArray(merchandiseSelectionsTable.funeralHomeId, homeIds))
    .groupBy(merchandiseSelectionsTable.funeralHomeId);

  for (const row of selections) {
    at(row.homeId).storefrontSelections = row.total;
  }

  const slots = await db
    .select({
      homeId: appointmentSlotsTable.funeralHomeId,
      offered: count(),
      taken:
        sql<number>`count(*) filter (where ${appointmentSlotsTable.takenByCaseId} is not null)`.mapWith(
          Number,
        ),
    })
    .from(appointmentSlotsTable)
    .where(inArray(appointmentSlotsTable.funeralHomeId, homeIds))
    .groupBy(appointmentSlotsTable.funeralHomeId);

  for (const row of slots) {
    const entry = at(row.homeId);
    entry.slotsOffered = row.offered;
    entry.slotsTaken = row.taken;
  }

  return byHome;
}

/* ----------------------------------------------- per case, for the home -- */

/** One family member, and whether the link we sent them ever landed. */
export type ContactEngagement = {
  contactId: number;
  name: string;
  role: string;
  hasPhone: boolean;
  linkOpened: boolean;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  photographs: number;
  messages: number;
};

/**
 * Something a director might want to act on, said in a sentence.
 *
 * A list of observations rather than a status, a colour or a score. Each one
 * is phrased as what has not happened rather than as what somebody failed to
 * do, because a director reads these out loud on the telephone and "you have
 * not uploaded anything" is not a sentence to open that call with.
 */
export type CaseAttention = {
  key: string;
  sentence: string;
};

export type CaseEngagement = {
  caseId: number;
  contacts: ContactEngagement[];
  linksCreated: number;
  linksOpened: number;
  photographs: number;
  photographsSelected: number;
  messagesFromFamily: number;
  obituaryStatus: string | null;
  vitalsStatus: string | null;
  storefrontStatus: string | null;
  timelineOutstanding: number;
  timelineDone: number;
  aftercareEnrolled: number;
  aftercareConsented: number;
  aftercareUnsubscribed: number;
  attention: CaseAttention[];
};

/** Long enough that silence means something, short enough to still help. */
const QUIET_DAYS = 3;

export async function engagementForCase(
  row: Case,
  now = new Date(),
): Promise<CaseEngagement> {
  const contacts = await db
    .select()
    .from(familyContactsTable)
    .where(
      and(
        eq(familyContactsTable.caseId, row.id),
        eq(familyContactsTable.funeralHomeId, row.funeralHomeId),
      ),
    );

  const [
    photoRows,
    messageRows,
    obituary,
    vitals,
    selection,
    timeline,
    aftercare,
  ] = await Promise.all([
    db
      .select({
        contactId: casePhotosTable.uploadedByContactId,
        total: count(),
        selected:
          sql<number>`count(*) filter (where ${casePhotosTable.selected})`.mapWith(
            Number,
          ),
      })
      .from(casePhotosTable)
      .where(eq(casePhotosTable.caseId, row.id))
      .groupBy(casePhotosTable.uploadedByContactId),
    db
      .select({ contactId: caseMessagesTable.authorContactId, total: count() })
      .from(caseMessagesTable)
      .where(eq(caseMessagesTable.caseId, row.id))
      .groupBy(caseMessagesTable.authorContactId),
    db
      .select({ status: obituaryDraftsTable.status })
      .from(obituaryDraftsTable)
      .where(eq(obituaryDraftsTable.caseId, row.id))
      .limit(1),
    db
      .select({ status: vitalStatisticsTable.status })
      .from(vitalStatisticsTable)
      .where(eq(vitalStatisticsTable.caseId, row.id))
      .limit(1),
    db
      .select({ status: merchandiseSelectionsTable.status })
      .from(merchandiseSelectionsTable)
      .where(eq(merchandiseSelectionsTable.caseId, row.id))
      .limit(1),
    db
      .select({
        outstanding:
          sql<number>`count(*) filter (where ${caseDeadlinesTable.completedAt} is null and not ${caseDeadlinesTable.isEvent})`.mapWith(
            Number,
          ),
        done: sql<number>`count(*) filter (where ${caseDeadlinesTable.completedAt} is not null)`.mapWith(
          Number,
        ),
      })
      .from(caseDeadlinesTable)
      .where(eq(caseDeadlinesTable.caseId, row.id)),
    db
      .select({
        enrolled: count(),
        consented:
          sql<number>`count(*) filter (where ${aftercareEnrollmentsTable.consentedAt} is not null)`.mapWith(
            Number,
          ),
        unsubscribed:
          sql<number>`count(*) filter (where ${aftercareEnrollmentsTable.unsubscribedAt} is not null)`.mapWith(
            Number,
          ),
      })
      .from(aftercareEnrollmentsTable)
      .where(eq(aftercareEnrollmentsTable.caseId, row.id)),
  ]);

  const photosByContact = new Map(
    photoRows
      .filter((entry) => entry.contactId !== null)
      .map((entry) => [entry.contactId!, entry.total]),
  );
  const messagesByContact = new Map(
    messageRows
      .filter((entry) => entry.contactId !== null)
      .map((entry) => [entry.contactId!, entry.total]),
  );

  const perContact: ContactEngagement[] = contacts.map((contact) => ({
    contactId: contact.id,
    name: contact.name,
    role: contact.role,
    hasPhone: Boolean(contact.phone?.trim()),
    linkOpened: contact.firstSeenAt !== null,
    firstSeenAt: contact.firstSeenAt,
    lastSeenAt: contact.lastSeenAt,
    photographs: photosByContact.get(contact.id) ?? 0,
    messages: messagesByContact.get(contact.id) ?? 0,
  }));

  const engagement: CaseEngagement = {
    caseId: row.id,
    contacts: perContact,
    linksCreated: contacts.length,
    linksOpened: perContact.filter((entry) => entry.linkOpened).length,
    photographs: photoRows.reduce((total, entry) => total + entry.total, 0),
    photographsSelected: photoRows.reduce(
      (total, entry) => total + entry.selected,
      0,
    ),
    messagesFromFamily: messageRows
      .filter((entry) => entry.contactId !== null)
      .reduce((total, entry) => total + entry.total, 0),
    obituaryStatus: obituary[0]?.status ?? null,
    vitalsStatus: vitals[0]?.status ?? null,
    storefrontStatus: selection[0]?.status ?? null,
    timelineOutstanding: timeline[0]?.outstanding ?? 0,
    timelineDone: timeline[0]?.done ?? 0,
    aftercareEnrolled: aftercare[0]?.enrolled ?? 0,
    aftercareConsented: aftercare[0]?.consented ?? 0,
    aftercareUnsubscribed: aftercare[0]?.unsubscribed ?? 0,
    attention: [],
  };

  engagement.attention = attentionFor(row, engagement, now);
  return engagement;
}

/**
 * What a director would want to know before ringing this family.
 *
 * Every sentence has to survive being read aloud. No counts of failures, no
 * "overdue", no implication that the family is behind — the one that matters
 * most, an unopened link, is usually a wrong phone number rather than a
 * family ignoring anybody, and the copy says so because that is what sends
 * the director to the right fix.
 */
function attentionFor(
  row: Case,
  engagement: CaseEngagement,
  now: Date,
): CaseAttention[] {
  const notes: CaseAttention[] = [];

  /*
   * Nothing to chase on a closed case, and nothing to chase on a pre-need
   * one either: somebody arranging their own funeral in advance is not
   * stuck, they are simply not in a hurry, and "no photographs yet" is not a
   * sentence to put in front of a director about a person who is alive.
   */
  if (row.status === "closed" || row.kind === "pre_need") return notes;

  if (engagement.linksCreated === 0) {
    notes.push({
      key: "nobody-invited",
      sentence:
        "Nobody from the family has been sent a link yet, so nothing here is reaching them.",
    });
  } else if (engagement.linksOpened === 0) {
    const unopened = engagement.contacts.filter((entry) => !entry.linkOpened);
    const names = unopened.map((entry) => entry.name).join(" and ");
    notes.push({
      key: "link-not-opened",
      sentence: `${names} ${unopened.length === 1 ? "has" : "have"} not opened the link yet. It is worth checking the number before assuming they have seen it.`,
    });
  }

  const quietSince = new Date(now.getTime() - QUIET_DAYS * 86_400_000);
  const anyRecent = engagement.contacts.some(
    (entry) => entry.lastSeenAt !== null && entry.lastSeenAt > quietSince,
  );

  if (engagement.linksOpened > 0 && !anyRecent) {
    notes.push({
      key: "quiet",
      sentence: `Nobody has been back to the page in ${QUIET_DAYS} days. A short call is usually more welcome than another message.`,
    });
  }

  if (engagement.photographs === 0) {
    notes.push({
      key: "no-photographs",
      sentence:
        "No photographs yet. Families often have them on a phone and do not realise that is enough.",
    });
  }

  if (engagement.obituaryStatus === "family_draft") {
    notes.push({
      key: "obituary-with-family",
      sentence: "The obituary is still with the family.",
    });
  }

  if (engagement.vitalsStatus === "collecting") {
    notes.push({
      key: "vitals-incomplete",
      sentence:
        "The certificate details are part-filled. The gaps are usually the parents' names, which only the family knows.",
    });
  }

  if (row.serviceAt === null) {
    notes.push({
      key: "no-service-date",
      sentence:
        "There is no service date on this case, so the family's timeline has nothing to count from.",
    });
  }

  return notes;
}

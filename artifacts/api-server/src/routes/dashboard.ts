import { Router, type IRouter } from "express";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  caseDeadlinesTable,
  caseMessagesTable,
  casesTable,
  intakeRequestsTable,
  vendorQuotesTable,
  vendorsTable,
  decedentDisplayName,
} from "@workspace/db";
import { tenant } from "../middleware/require-auth";
import { isThreadLocked } from "../lib/thread";
import { casesAwaitingChoice } from "../lib/service-offers";

/**
 * The master page: one read for the screen a director opens first.
 *
 * Every number here is already reachable somewhere else in this API, and
 * that is the point rather than a criticism of it. This product is organised
 * around a case, because that is how the work is organised — but a director
 * with four funerals this week does not experience four cases, they
 * experience a Tuesday. Nothing above told them that a family answered at
 * midnight, that the Hale service is tomorrow, and that two timeline steps
 * went past due while they were at a graveside.
 *
 * The shape of every query below is the same: scope on the home read off the
 * signed-in user's row, cap what comes back, and never load the case list.
 * A home three years in has hundreds of cases, and a landing page that reads
 * all of them stops being a landing page some time in year two.
 */

const router: IRouter = Router();

/** How many rows of each list the screen can usefully hold. */
const LIST_LIMIT = 8;
const DUE_SOON_DAYS = 3;
const SERVICES_AHEAD_DAYS = 7;
/** A list entry is a glance, not the message. */
const PREVIEW_LENGTH = 140;

/**
 * Threads the home can still write on.
 *
 * `messagesLockAt` is null until a case closes, and in the fortnight between
 * closing and locking both sides can still speak — so this is deliberately
 * "not locked" rather than "not closed". A director who closes a file on
 * Tuesday can still answer the question that arrives on Wednesday, and the
 * counts should say so.
 */
const unlockedThread = (now: Date) =>
  or(isNull(casesTable.messagesLockAt), gt(casesTable.messagesLockAt, now));
/**
 * A price request nobody has answered, on a case still open.
 *
 * "Answered" is the same test `PUT /quotes/:id` uses to stamp `respondedAt`:
 * an amount or a reply recorded. Status alone is not enough — `passed_on`
 * means the home rang the vendor, and the family is still waiting to hear.
 * A request marked declined without a word written is closed too, because
 * the family has been told the outcome on their page.
 */
const unansweredQuotes = (funeralHomeId: number) =>
  and(
    eq(vendorQuotesTable.funeralHomeId, funeralHomeId),
    isNull(vendorQuotesTable.respondedAt),
    inArray(vendorQuotesTable.status, ["requested", "passed_on"]),
    ne(casesTable.status, "closed"),
  );

/**
 * How many conversations the inbox will hand back.
 *
 * Unbounded, this is the one screen in the console that grows without limit:
 * a home three years in has a thread per family it has ever served, and this
 * is opened every morning. Fifty is far past what anyone scrolls, and the
 * ordering puts everyone who is actually waiting above everyone who is not,
 * so nothing that needs an answer falls off the end.
 */
export const INBOX_LIMIT = 50;

router.get("/home/dashboard", async (req, res) => {
  const home = tenant(req);
  const now = new Date();
  const soon = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000);
  const weekAhead = new Date(
    now.getTime() + SERVICES_AHEAD_DAYS * 24 * 60 * 60 * 1000,
  );

  /* Open, meaning not closed: a case at `intake` is one nobody has invited a
   * family to yet, and it is exactly the one a director forgets. */
  const openCases = and(
    eq(casesTable.funeralHomeId, home.id),
    ne(casesTable.status, "closed"),
  );

  const [
    openCount,
    servicesThisWeek,
    awaitingServiceDate,
    overdue,
    dueSoon,
    unread,
    pendingRequests,
    awaitingChoice,
    quoteCount,
    quoteRows,
  ] = await Promise.all([
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(casesTable)
      .where(openCases),

    db
      .select({
        caseId: casesTable.id,
        decedentFirstName: casesTable.decedentFirstName,
        decedentLastName: casesTable.decedentLastName,
        decedentPreferredName: casesTable.decedentPreferredName,
        kind: casesTable.kind,
        serviceAt: casesTable.serviceAt,
        serviceLocation: casesTable.serviceLocation,
      })
      .from(casesTable)
      .where(
        and(
          openCases,
          gte(casesTable.serviceAt, now),
          lte(casesTable.serviceAt, weekAhead),
        ),
      )
      .orderBy(asc(casesTable.serviceAt))
      .limit(LIST_LIMIT),

    /*
     * Active cases with no service date.
     *
     * This list earns its place because of how the standard schedule works:
     * every step is an offset from the service, so a case without one has an
     * empty timeline and a family who has been told nothing about when
     * anything is due. It is the quietest way for this product to fail, and
     * it fails silently — which is why it is on the first screen.
     */
    db
      .select({
        caseId: casesTable.id,
        decedentFirstName: casesTable.decedentFirstName,
        decedentLastName: casesTable.decedentLastName,
        decedentPreferredName: casesTable.decedentPreferredName,
        kind: casesTable.kind,
        openedAt: casesTable.createdAt,
      })
      .from(casesTable)
      .where(
        and(
          eq(casesTable.funeralHomeId, home.id),
          eq(casesTable.status, "active"),
          isNull(casesTable.serviceAt),
        ),
      )
      .orderBy(asc(casesTable.createdAt))
      .limit(LIST_LIMIT),

    deadlineWindow(home.id, { before: now, newestFirst: true }),
    deadlineWindow(home.id, { from: now, before: soon }),

    /*
     * Unanswered family messages, and how many families they are.
     *
     * Both numbers, because they say different things. Twenty messages from
     * one family is a conversation; four messages from four families is four
     * people each waiting on an answer, which is the worse morning.
     *
     * "Unanswered" means written after the home last wrote on that thread —
     * so a family is waiting exactly when the latest message is theirs. This
     * used to count *unread* messages, and opening a thread marks it read,
     * so a director who glanced at a message on their phone between
     * services made the family disappear from this screen without a word
     * being sent back. Read is a "new" marker; only a reply is an answer.
     */
    db
      .select({
        messages: sql<number>`count(*)::int`,
        cases: sql<number>`count(distinct ${caseMessagesTable.caseId})::int`,
      })
      .from(caseMessagesTable)
      .innerJoin(casesTable, eq(casesTable.id, caseMessagesTable.caseId))
      .where(
        and(
          eq(caseMessagesTable.funeralHomeId, home.id),
          // Written by the family...
          isNull(caseMessagesTable.authorUserId),
          // ...since the home last wrote. Ids are the thread's order, the
          // same order the inbox reads "latest" from.
          sql`${caseMessagesTable.id} > coalesce((
            select max(reply.id) from case_messages reply
            where reply.case_id = ${caseMessagesTable.caseId}
              and reply.author_user_id is not null
          ), 0)`,
          /*
           * And on a thread the home could still answer.
           *
           * A locked thread accepts nothing from either side, so a message
           * sitting unread behind one is not a family waiting on a reply —
           * it is a family who cannot be replied to. Counting it puts a
           * number on this screen that no amount of work will ever clear,
           * pointing at an inbox row with no reply box, which is how a
           * director learns to stop believing the tile.
           */
          unlockedThread(now),
        ),
      ),

    db
      .select({ value: sql<number>`count(*)::int` })
      .from(intakeRequestsTable)
      .where(
        and(
          eq(intakeRequestsTable.funeralHomeId, home.id),
          eq(intakeRequestsTable.status, "pending"),
        ),
      ),

    casesAwaitingChoice(home.id),

    /*
     * Prices a family asked for from their portal, not yet answered.
     *
     * The family presses one button and is told the home will find out. If
     * nothing on this screen says so, the only person who knows the request
     * exists is the one waiting on it. Oldest first, because the family who
     * asked on Monday has waited longest.
     */
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(vendorQuotesTable)
      .innerJoin(casesTable, eq(casesTable.id, vendorQuotesTable.caseId))
      .where(unansweredQuotes(home.id)),

    db
      .select({
        id: vendorQuotesTable.id,
        caseId: vendorQuotesTable.caseId,
        vendorName: vendorsTable.name,
        requestedAt: vendorQuotesTable.createdAt,
        decedentFirstName: casesTable.decedentFirstName,
        decedentLastName: casesTable.decedentLastName,
        decedentPreferredName: casesTable.decedentPreferredName,
      })
      .from(vendorQuotesTable)
      .innerJoin(casesTable, eq(casesTable.id, vendorQuotesTable.caseId))
      .innerJoin(vendorsTable, eq(vendorsTable.id, vendorQuotesTable.vendorId))
      .where(unansweredQuotes(home.id))
      .orderBy(asc(vendorQuotesTable.createdAt))
      .limit(LIST_LIMIT),
  ]);

  res.json({
    homeName: home.name,
    openCases: openCount[0]?.value ?? 0,
    servicesThisWeek: servicesThisWeek.map((row) => ({
      caseId: row.caseId,
      decedentName: decedentDisplayName(row),
      kind: row.kind,
      serviceAt: row.serviceAt,
      serviceLocation: row.serviceLocation,
    })),
    awaitingServiceDate: awaitingServiceDate.map((row) => ({
      caseId: row.caseId,
      decedentName: decedentDisplayName(row),
      kind: row.kind,
      openedAt: row.openedAt,
    })),
    overdue,
    dueSoon,
    unansweredMessages: unread[0]?.messages ?? 0,
    casesWaitingOnReply: unread[0]?.cases ?? 0,
    quoteRequestsWaiting: quoteCount[0]?.value ?? 0,
    quoteRequests: quoteRows.map((row) => ({
      id: row.id,
      caseId: row.caseId,
      decedentName: decedentDisplayName(row),
      vendorName: row.vendorName,
      requestedAt: row.requestedAt,
    })),
    pendingRequests: pendingRequests[0]?.value ?? 0,
    offersAwaitingChoice: awaitingChoice.length,
    /*
     * Where this home stands on money is deliberately absent. `/billing`
     * answers that, the console's trial banner reads it from there, and a
     * second copy on this screen would be a second source of truth for the
     * one subject this codebase is most careful to keep single.
     */
  });
});

/**
 * Timeline entries across every open case, in one window of time.
 *
 * Events are excluded on purpose. "The service" is an entry on the timeline
 * and it has a date, but it is not a thing anybody can do, and putting a
 * funeral in a list headed "overdue" would be grotesque.
 */
async function deadlineWindow(
  funeralHomeId: number,
  window: { from?: Date; before: Date; newestFirst?: boolean },
) {
  const rows = await db
    .select({
      id: caseDeadlinesTable.id,
      caseId: caseDeadlinesTable.caseId,
      title: caseDeadlinesTable.title,
      dueAt: caseDeadlinesTable.dueAt,
      isEvent: caseDeadlinesTable.isEvent,
      decedentFirstName: casesTable.decedentFirstName,
      decedentLastName: casesTable.decedentLastName,
      decedentPreferredName: casesTable.decedentPreferredName,
    })
    .from(caseDeadlinesTable)
    .innerJoin(casesTable, eq(casesTable.id, caseDeadlinesTable.caseId))
    .where(
      and(
        eq(caseDeadlinesTable.funeralHomeId, funeralHomeId),
        ne(casesTable.status, "closed"),
        isNull(caseDeadlinesTable.completedAt),
        eq(caseDeadlinesTable.isEvent, false),
        lt(caseDeadlinesTable.dueAt, window.before),
        window.from ? gt(caseDeadlinesTable.dueAt, window.from) : undefined,
      ),
    )
    /*
     * Overdue comes back most recently slipped first; what is coming comes
     * back soonest first. Both are "the ones a director can still do
     * something about", and for the overdue list that is the opposite
     * direction from the obvious one.
     *
     * Oldest-first with a cap of eight is a list that never changes. A home
     * with one case left open from two years ago — which is every home,
     * because closing a file is the step people forget — would have its eight
     * slots filled by that case permanently, and this week's slipped
     * photographs would never appear at all.
     */
    .orderBy(
      window.newestFirst
        ? desc(caseDeadlinesTable.dueAt)
        : asc(caseDeadlinesTable.dueAt),
    )
    .limit(LIST_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    caseId: row.caseId,
    decedentName: decedentDisplayName(row),
    title: row.title,
    dueAt: row.dueAt,
    isEvent: row.isEvent,
  }));
}

/**
 * Every family conversation in one list, the ones waiting first.
 *
 * The product's central promise is one contained thread per family. That
 * promise is kept case by case, and the cost of keeping it was that a
 * director had no way to see across them: the only way to find out the
 * Okonkwo family wrote at midnight was to open the Okonkwo case.
 *
 * Replying is not here, deliberately. A reply goes through
 * `POST /cases/:caseId/messages`, which is the one place the out-of-hours
 * stamp is applied and the one place the fortnight lock is enforced — a
 * second write path would be a second place to forget both.
 */
router.get("/home/inbox", async (req, res) => {
  const home = tenant(req);
  const now = new Date();

  /*
   * One row per case: the latest message, and how many the home has not
   * opened. Done as a lateral rather than by loading every message and
   * folding them in JavaScript, because a home three years in has tens of
   * thousands and this is a screen somebody opens every morning.
   */
  const latest = db
    .select({
      caseId: caseMessagesTable.caseId,
      lastId: sql<number>`max(${caseMessagesTable.id})`.as("last_id"),
      // Unread *and* written by the family. The home's own unread messages
      // are unread by the family, which is not the home's problem.
      unread: sql<number>`count(*) filter (
        where ${caseMessagesTable.readAt} is null
          and ${caseMessagesTable.authorUserId} is null
      )::int`.as("unread"),
    })
    .from(caseMessagesTable)
    .where(eq(caseMessagesTable.funeralHomeId, home.id))
    .groupBy(caseMessagesTable.caseId)
    .as("latest");

  const rows = await db
    .select({
      caseId: casesTable.id,
      decedentFirstName: casesTable.decedentFirstName,
      decedentLastName: casesTable.decedentLastName,
      decedentPreferredName: casesTable.decedentPreferredName,
      kind: casesTable.kind,
      messagesLockAt: casesTable.messagesLockAt,
      body: caseMessagesTable.body,
      createdAt: caseMessagesTable.createdAt,
      authorUserId: caseMessagesTable.authorUserId,
      sentOutsideOfficeHours: caseMessagesTable.sentOutsideOfficeHours,
      unread: latest.unread,
    })
    .from(latest)
    .innerJoin(caseMessagesTable, eq(caseMessagesTable.id, latest.lastId))
    .innerJoin(casesTable, eq(casesTable.id, latest.caseId))
    /*
     * Waiting first — the latest word is the family's and the thread can
     * still be answered — then everything by recency. This used to sort by
     * unread count, which put a family the director had opened but not
     * answered below one they had answered at length.
     */
    .orderBy(
      desc(
        sql`(${caseMessagesTable.authorUserId} is null
          and (${casesTable.messagesLockAt} is null
            or ${casesTable.messagesLockAt} > ${now}))`,
      ),
      desc(caseMessagesTable.createdAt),
    )
    .limit(INBOX_LIMIT);

  res.json(
    rows.map((row) => {
      const locked = isThreadLocked(row, now);
      const fromFamily = row.authorUserId === null;

      return {
        caseId: row.caseId,
        decedentName: decedentDisplayName(row),
        kind: row.kind,
        lastMessageBody: preview(row.body),
        lastMessageAt: row.createdAt,
        lastMessageFrom: fromFamily ? "family" : "home",
        unreadFromFamily: row.unread,
        // Who spoke last, not whether anybody has looked. Same definition
        // as the dashboard's count, so the tile and this list agree.
        waitingOnReply: fromFamily && !locked,
        sentOutsideOfficeHours:
          fromFamily && row.sentOutsideOfficeHours !== null,
        locked,
      };
    }),
  );
});

/** A glance, not the message. Cut on a word so it does not end mid-name. */
function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_LENGTH) return flat;

  const cut = flat.slice(0, PREVIEW_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > PREVIEW_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export default router;

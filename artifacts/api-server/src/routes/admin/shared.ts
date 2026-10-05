import {
  aftercareEnrollmentsTable,
  canOpenCases,
  casePhotosTable,
  casesTable,
  db,
  familyContactsTable,
  funeralHomesTable,
  homeLicensureTable,
  platformAuditTable,
  practitionerLicencesTable,
  trialDaysLeft,
  usersTable,
  type FuneralHome,
  type HomeLicensure,
  type PractitionerLicence,
} from "@workspace/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { type RequestHandler } from "express";
import { normaliseEmail } from "../../lib/auth";
import { HttpError, requireRow } from "../../lib/http";
import { isPlatformAdmin } from "../../lib/platform-auth";
import { currentUser } from "../../middleware/require-auth";

/** The platform-admin gate, the audit trail and the helpers every admin route shares. */

/**
 * The platform admin console: Heather looking at her own customers.
 *
 * Read this file before you change it, because it is the only place in the
 * codebase that is *supposed* to read across the tenant boundary, and that
 * makes it the most dangerous thing here.
 *
 * Three rules hold it together, and none of them is optional:
 *
 *  1. **This router is mounted below `requireAuth`, not beside it.** A
 *     platform admin is a signed-in staff account plus a membership check.
 *     Nothing in this file relaxes the session gate, and nothing in it
 *     introduces a second way to authenticate — which would be two doors to
 *     keep locked instead of one.
 *
 *  2. **Every cross-tenant read goes through a helper whose name begins with
 *     `platform`.** `tenant(req)` is never called in this file. If you find
 *     yourself wanting it, you are writing a staff route in the wrong place.
 *
 *  3. **Every cross-tenant read is audited before the data is returned.** The
 *     helper that first names a home — `platformListHomes`, `platformLoadHome`
 *     or the overview — writes the row itself, awaited, not fired and
 *     forgotten and not behind a flag. The two that only ever run *after* one
 *     of those (`platformEngagementFor`, `platformLicensureFor`) say so on
 *     themselves; calling either from anywhere new means auditing there.
 *     Two refinements, both in `recordPlatformAccess` and
 *     `platformFindHomeForChange`: the same look repeated within a few
 *     minutes is one line, not one per request, and a change that has to be
 *     checked first is logged after the check and before the change, so a
 *     refused request never leaves a line saying it happened.
 *
 * And one rule about what it may do at all: a platform admin can create a
 * home and suspend a home. That is the complete list of writes that touch a
 * tenant. There is no route here that edits a case, an obituary, a
 * photograph, a message or a family contact, there is no business reason for
 * one, and the compliance reason against it is in Section 2 of `COLORADO.md`
 * — we are the processor, the home is the controller, and a processor that
 * can quietly rewrite a family's obituary is not a processor.
 *
 * (Two more have joined that list since, and both are narrower than they
 * sound: marking a home as our own, which changes only which figures it is
 * counted in, and emailing a director a password-reset link to their own
 * inbox, which never shows the link here -- see that route for why. Two more
 * after those: inviting an owner into a home that has none, and giving a
 * home on trial more time. Neither reads or changes anything a family put
 * there.)
 */

/* ------------------------------------------------------------- the gate -- */

export type PlatformActor = { email: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      platformActor?: PlatformActor;
    }
  }
}

/**
 * The gate. A signed-in staff account that is also on `platform_admins`.
 *
 * The membership check now reads a table rather than `PLATFORM_ADMIN_EMAILS`
 * — see `lib/platform-auth.ts` for why, and for the one-time bootstrap that
 * keeps a fresh deployment from locking everyone out. The shape of the check is
 * unchanged, and the properties that matter are the same ones the environment
 * variable had:
 *
 *  - It is **closed by default**. An empty table means nobody is a platform
 *    admin and every route in this file answers 403 — including to an owner,
 *    including in production. A half-built console that is reachable is worse
 *    than one that is not.
 *  - It grants nothing on its own. Being on the list still requires knowing
 *    the password of a real staff account, so this is an additional condition
 *    and never an alternative one.
 *  - It is not a permission model. There is one capability and no hierarchy,
 *    because inventing a second role system is exactly what `CONTRIBUTING.md`
 *    says not to do.
 *
 * The 403 says nothing about why. A director who mistypes a URL learns that
 * the route is not theirs, and learns nothing about whether an admin console
 * exists, who is on it, or how one gets there.
 *
 * **The address must be confirmed.** The list names email addresses, and
 * registration is open and never checked that the person typing an address
 * owns it -- that is a deliberate trade for directors (see `replit.md`), and
 * it is exactly the wrong trade here. Without this line anybody could register
 * a home under an address on the list that had no account yet -- the seeded
 * bootstrap address before its owner first signs up, or a colleague granted
 * access ahead of their first day, which the Admins page invites -- and walk
 * straight into every customer's account list. The same went for an owner
 * inviting that address into their own home and redeeming the invitation link
 * handed back on screen. A confirmation link only ever reaches the real inbox,
 * so requiring it is what makes the list mean the *person* rather than the
 * string.
 */
export const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const user = currentUser(req);

      if (!user.emailVerified || !(await isPlatformAdmin(user.email))) {
        throw new HttpError(403, "Not found");
      }

      req.platformActor = { email: normaliseEmail(user.email) };
      next();
    } catch (error) {
      next(error);
    }
  })();
};

/** Narrowing helper, the same shape as `currentUser` and for the same reason. */
export function actor(req: { platformActor?: PlatformActor }): PlatformActor {
  if (!req.platformActor) {
    throw new HttpError(500, "Route is missing the platform admin gate");
  }
  return req.platformActor;
}

/* ------------------------------------------------------------ the audit -- */

/**
 * The actions that can appear in the log. A closed list rather than free
 * strings, so that "show me every time anyone opened a home" stays a query
 * somebody can actually write in a year's time.
 */
export const AUDIT_ACTIONS = [
  "homes.list",
  "home.open",
  "home.create",
  "home.suspend",
  "home.restore",
  "home.licensure.update",
  "home.practitioner.update",
  "home.group.update",
  "group.list",
  "group.create",
  "group.open",
  "group.checkout",
  "platform.overview",
  "platform.admins.list",
  "platform.admin.grant",
  "platform.admin.revoke",
  "home.internal.update",
  "home.crm.update",
  "home.staff.reset",
  "home.owner.invite",
  "home.trial.extend",
  "plan.create",
  "plan.update",
  "plan.delete",
  "running-cost.create",
  "running-cost.update",
  "running-cost.delete",
  "home.sms.update",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * The actions that are only *looking*, as opposed to changing something.
 *
 * These are the ones a person generates by using the console normally --
 * opening a home, coming back to the overview, paging through the list -- and
 * the ones that, logged every time, buried the log. A director's insurer
 * reading "Opened Horan & McConaty" eleven times in four minutes learns less
 * than one line would have told them, and the change that actually matters
 * (a suspension, a reset link) scrolls off the first page.
 *
 * Writes are never on this list. Every change is recorded every time.
 */
export const READ_ACTIONS: ReadonlySet<AuditAction> = new Set<AuditAction>([
  "homes.list",
  "home.open",
  "group.list",
  "group.open",
  "platform.overview",
  "platform.admins.list",
]);

/** How long one "looked at it" line stands for repeated looks. */
export const READ_AUDIT_WINDOW_MS = 5 * 60 * 1000;

/**
 * Record that somebody at the platform looked at, or changed, a home.
 *
 * Awaited rather than fired and forgotten. Elsewhere in this codebase a
 * bookkeeping write that fails is allowed to fail quietly — `markOnboarding`
 * does exactly that — because a missing checkbox costs nobody anything. This
 * one is the difference between "we can show you every time anyone at the
 * vendor saw your families' names" and "we think we can", so a read whose
 * audit row did not land does not get to return data.
 */
export async function recordPlatformAccess(
  who: PlatformActor,
  action: AuditAction,
  subject: { id: number; name: string } | null,
  detail?: string,
): Promise<void> {
  /*
   * One line per look, not one per request.
   *
   * The same person reading the same thing again within a few minutes -- the
   * console refetching after a save, a second tab, the back button -- is the
   * same look, and a line for each made the log unreadable. The detail is
   * part of what counts as "the same": searching for one director's address
   * and then another's is two different questions, and the second must not
   * vanish because it came soon after the first.
   *
   * Checked here rather than in the console, because the console is only one
   * client and the log has to be right whoever is calling.
   */
  if (READ_ACTIONS.has(action)) {
    // Measured against the database's clock, the same one `defaultNow()`
    // stamped the earlier line with, so a server whose own clock or zone
    // disagrees with Postgres cannot stretch or shrink the window.
    const since = sql`now() - make_interval(secs => ${READ_AUDIT_WINDOW_MS / 1000})`;
    const [recent] = await db
      .select({ id: platformAuditTable.id })
      .from(platformAuditTable)
      .where(
        and(
          eq(platformAuditTable.actorEmail, who.email),
          eq(platformAuditTable.action, action),
          subject
            ? eq(platformAuditTable.subjectHomeId, subject.id)
            : isNull(platformAuditTable.subjectHomeId),
          detail === undefined
            ? isNull(platformAuditTable.detail)
            : eq(platformAuditTable.detail, detail),
          sql`${platformAuditTable.createdAt} >= ${since}`,
        ),
      )
      .limit(1);

    if (recent) return;
  }

  await db.insert(platformAuditTable).values({
    actorEmail: who.email,
    action,
    subjectHomeId: subject?.id ?? null,
    subjectHomeName: subject?.name ?? null,
    detail: detail ?? null,
  });
}

/**
 * Which homes are customers.
 *
 * Every figure the business makes about itself is filtered on this, and it is
 * one expression rather than four so the homes list and the counts can never
 * disagree about who is being counted.
 *
 * A platform admin needs a staff account, a staff account needs a
 * `funeral_homes` row, and that row is not a customer. Left in, it turned the
 * overview into a lie in the least useful direction: the console reported three
 * homes on trial when one of the three was us, which is the number a founder
 * would quote at somebody.
 */
export const customerHomes = eq(funeralHomesTable.internalAccount, false);

/* ------------------------------------------- the cross-tenant helpers -- */

/**
 * Below this line, every function reads rows belonging to homes other than
 * the caller's own. They all take the actor, they all audit, and they are all
 * named so that a reviewer scanning a diff can see one being called.
 */

/** One home, by the id in the URL. The only lookup that accepts an id. */
export async function platformLoadHome(
  who: PlatformActor,
  homeId: number,
  action: AuditAction = "home.open",
  detail?: string,
): Promise<FuneralHome> {
  const home = await platformFindHomeForChange(homeId);
  await recordPlatformAccess(who, action, home, detail);
  return home;
}

/**
 * One home, *not yet audited*, for a route that changes something and has to
 * check the request first.
 *
 * Writing the log line before the checks meant a refused request -- a group
 * that does not exist, a person who works somewhere else -- left a line saying
 * the change had been made, and the log is the one page here that is shown to
 * customers as the truth. So the few routes that validate against the home
 * load it with this, check, and then call `recordPlatformAccess` themselves
 * before they write anything or return anything.
 *
 * It reads the `funeral_homes` row only. Calling it from a route that does
 * not then audit is the mistake rule 3 at the top of this file is about.
 */
export async function platformFindHomeForChange(
  homeId: number,
): Promise<FuneralHome> {
  const [row] = await db
    .select()
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.id, homeId))
    .limit(1);

  return requireRow(row, "That home could not be found.");
}

export const HOME_STATUSES = [
  "trial",
  "active",
  "past_due",
  "canceled",
  "suspended",
] as const;
export type HomeStatus = (typeof HOME_STATUSES)[number];

/** The customer list. Names and account state only — no case ever loads here. */
export async function platformListHomes(
  who: PlatformActor,
  options: {
    search?: string | undefined;
    limit: number;
    offset: number;
    includeInternal?: boolean;
    /** Our own homes only -- the other way to find a home marked ours. */
    ours?: boolean | undefined;
    status?: HomeStatus | undefined;
    sort?: "name" | "plan" | "amount" | "dueDate" | undefined;
    order?: "asc" | "desc" | undefined;
  },
): Promise<{ homes: FuneralHome[]; total: number }> {
  const search = options.search?.trim();
  // `%` and `_` are wildcards to ILIKE, so a search for "100%" or "a_b" was
  // matching far more than it said. Escaped, so what is typed is what is found.
  const pattern = search ? `%${search.replace(/[\\%_]/g, "\\$&")}%` : "";

  /*
   * An exact staff address finds the home it belongs to.
   *
   * The first thing a locked-out director on the telephone can give you is
   * their email address, and before this the console could not turn that into
   * a home: it searched names and web addresses only, and deliberately shows
   * nobody's address. Exact rather than partial, so this answers "whose
   * account is this" and cannot be used to browse a customer's staff list a
   * letter at a time -- and the address still never comes back in the answer.
   */
  const byStaffEmail = search?.includes("@")
    ? sql`${funeralHomesTable.id} in (select ${usersTable.funeralHomeId} from ${usersTable} where ${usersTable.email} = ${normaliseEmail(search)})`
    : undefined;

  const filter = search
    ? or(
        ilike(funeralHomesTable.name, pattern),
        ilike(funeralHomesTable.slug, pattern),
        ...(byStaffEmail ? [byStaffEmail] : []),
      )
    : undefined;

  /*
   * Our own homes, when asked for.
   *
   * Leaving them out by default is right -- the list is "our customers" -- but
   * leaving them out with no way back meant a home marked ours by mistake
   * could only be found again by typing its id into the address bar, and the
   * console's own "It's a customer" button was unreachable.
   */
  // `ours` lists them on their own; `includeInternal` alongside customers.
  const whose = options.ours
    ? eq(funeralHomesTable.internalAccount, true)
    : options.includeInternal
      ? undefined
      : customerHomes;

  /*
   * By account state, in the same words the list shows. A suspended home is
   * "Suspended" whatever its subscription says, so the other four exclude
   * it: filtering for "on trial" and getting a suspended home back would be
   * the list disagreeing with itself.
   */
  const byStatus =
    options.status === undefined
      ? undefined
      : options.status === "suspended"
        ? isNotNull(funeralHomesTable.suspendedAt)
        : and(
            eq(funeralHomesTable.subscriptionStatus, options.status),
            isNull(funeralHomesTable.suspendedAt),
          );

  const scoped = and(whose, filter, byStatus);

  /*
   * Sorting is done here, in the database, not in the browser -- a sorted
   * first page of an unsorted list is a lie about the other pages. The
   * columns the financials screen cares about (plan, amount, next due date)
   * are the ones this offers.
   */
  const sortColumn = {
    name: funeralHomesTable.name,
    plan: funeralHomesTable.subscriptionPlan,
    amount: funeralHomesTable.billingAmountCents,
    dueDate: funeralHomesTable.subscriptionDueDate,
  }[options.sort ?? "name"];
  const orderBy = options.order === "desc" ? desc(sortColumn) : asc(sortColumn);

  const homes = await db
    .select()
    .from(funeralHomesTable)
    .where(scoped)
    .orderBy(orderBy, asc(funeralHomesTable.id))
    .limit(options.limit)
    .offset(options.offset);

  const [totals] = await db
    .select({ total: count() })
    .from(funeralHomesTable)
    .where(scoped);

  const qualifiers = [
    options.status ? `status ${options.status}` : null,
    options.ours
      ? "our own"
      : options.includeInternal
        ? "including ours"
        : null,
  ].filter(Boolean);

  await recordPlatformAccess(
    who,
    "homes.list",
    null,
    (search ? `searched for "${search}"` : `${homes.length} homes listed`) +
      (qualifiers.length > 0 ? ` (${qualifiers.join(", ")})` : ""),
  );

  return { homes, total: totals?.total ?? 0 };
}

/**
 * How much of the product a home is actually using.
 *
 * Counts only — `count(*)`, grouped by home. No row of a case, a family
 * contact, a photograph or an enrolment is ever selected here, which is why
 * a number that came from forty homes at once is not forty homes' data.
 *
 * Audited by its caller, not by itself: it is only reachable after
 * `platformListHomes`, `platformLoadHome` or the overview has already written
 * the row naming the homes in question, and logging twice for one screen
 * makes the log harder to read rather than more honest. A new caller has to
 * audit before calling it.
 *
 * TODO(C6): Component 6 owns how engagement is computed and will expose these
 * numbers from `routes/engagement.ts`. When it lands, the body of this
 * function is replaced by a call to theirs and the shape below stays.
 *
 * Until then these are the most literal counts the existing tables support,
 * on purpose. The temptation is to be clever here — to weight a home that
 * sends links but never gets them opened, to define "active" — and every
 * clever definition written here is one that will disagree with Component
 * 6's, which is the version a director will eventually see. Two sources of
 * truth for "how engaged is this home" is worse than none.
 */
export async function platformEngagementFor(
  homeIds: readonly number[],
): Promise<Map<number, Engagement>> {
  const blank = (): Engagement => ({
    casesOpened: 0,
    casesActive: 0,
    familyLinksCreated: 0,
    familyLinksOpened: 0,
    photographs: 0,
    aftercareEnrolled: 0,
    aftercareConsented: 0,
    aftercareDeclined: 0,
    aftercareUnsubscribed: 0,
  });

  const byHome = new Map<number, Engagement>(
    homeIds.map((id) => [id, blank()]),
  );

  if (homeIds.length === 0) return byHome;

  const at = (id: number) => byHome.get(id) ?? blank();

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
    })
    .from(familyContactsTable)
    .where(inArray(familyContactsTable.funeralHomeId, homeIds))
    .groupBy(familyContactsTable.funeralHomeId);

  for (const row of contacts) {
    const entry = at(row.homeId);
    entry.familyLinksCreated = row.created;
    entry.familyLinksOpened = row.opened;
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
    // Enrolled, never said yes, and has not asked to stop. The family that
    // simply did not answer — which is most of them, and is not a failure.
    entry.aftercareDeclined = Math.max(
      0,
      row.enrolled - row.consented - row.unsubscribed,
    );
  }

  return byHome;
}

export type Engagement = {
  casesOpened: number;
  casesActive: number;
  familyLinksCreated: number;
  familyLinksOpened: number;
  photographs: number;
  aftercareEnrolled: number;
  aftercareConsented: number;
  aftercareDeclined: number;
  aftercareUnsubscribed: number;
};

/**
 * A home's Colorado paperwork. Platform-owned, and the home never sees it.
 *
 * Audited by its caller for the same reason as `platformEngagementFor`: every
 * path to it runs `platformLoadHome` first.
 */
export async function platformLicensureFor(homeId: number): Promise<{
  licensure: HomeLicensure | null;
  practitioners: PractitionerLicence[];
}> {
  const [licensure] = await db
    .select()
    .from(homeLicensureTable)
    .where(eq(homeLicensureTable.funeralHomeId, homeId))
    .limit(1);

  const practitioners = await db
    .select()
    .from(practitionerLicencesTable)
    .where(eq(practitionerLicencesTable.funeralHomeId, homeId))
    .orderBy(
      asc(practitionerLicencesTable.personName),
      asc(practitionerLicencesTable.id),
    );

  return { licensure: licensure ?? null, practitioners };
}

/* ------------------------------------------------------- what we return -- */

/**
 * A home as the console sees it.
 *
 * Built by hand rather than spreading the row, so that adding a column to
 * `funeral_homes` never silently widens what the platform can see. Stripe
 * ids in particular stay here: the console shows whether a home is paying,
 * not how to charge it.
 */
export function toAdminHome(home: FuneralHome) {
  return {
    id: home.id,
    name: home.name,
    slug: home.slug,
    city: home.city,
    region: home.region,
    phone: home.phone,
    timezone: home.timezone,
    accentColor: home.accentColor,
    subscriptionStatus: home.subscriptionStatus,
    trialDaysLeft: trialDaysLeft(home),
    // The dates behind the status. "On trial, 3 days left" answers the
    // question on the day; the date is what goes in the follow-up email, and
    // a renewal date is the only way to tell "subscribed" from "subscribed
    // until Friday".
    trialEndsAt: home.trialEndsAt,
    currentPeriodEndsAt: home.currentPeriodEndsAt,
    // Which contract pays for it, when it is not its own. A home in a group
    // cannot have its trial extended or its billing changed from here -- the
    // group's does that -- and the page has to be able to say so.
    groupId: home.groupId,
    canOpenCases: canOpenCases(home),
    suspendedAt: home.suspendedAt,
    suspendedReason: home.suspendedReason,
    internalAccount: home.internalAccount,
    // Phase 1 §4b/§4c — Heather's own customer record for this home: the
    // commercial relationship, not the home's. These columns are the reason
    // the template exists, and they never leave the admin console: the
    // director-facing `/home` serialiser strips them (see routes/home.ts).
    contactName: home.contactName,
    subscriptionPlan: home.subscriptionPlan,
    billingPeriod: home.billingPeriod,
    billingAmountCents: home.billingAmountCents,
    billingStartDate: home.billingStartDate,
    subscriptionDueDate: home.subscriptionDueDate,
    discount: home.discount,
    howHeardAboutUs: home.howHeardAboutUs,
    adminNotes: home.adminNotes,
    onboardingDone: home.onboardingDone
      .split(",")
      .map((step) => step.trim())
      .filter(Boolean),
    createdAt: home.createdAt,
  };
}

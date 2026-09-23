import { Router, type IRouter, type RequestHandler } from "express";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  funeralHomesTable,
  usersTable,
  casesTable,
  familyContactsTable,
  casePhotosTable,
  aftercareEnrollmentsTable,
  homeGroupsTable,
  homeLicensureTable,
  practitionerLicencesTable,
  platformAuditTable,
  licensureReminders,
  canOpenCases,
  trialDaysLeft,
  LICENCE_STANDINGS,
  PRACTITIONER_ROLES,
  TRIAL_DAYS,
  ADD_ONS,
  isAddOnKey,
  serialiseEntitlements,
  type AddOnKey,
  type FuneralHome,
  type HomeGroup,
  type HomeLicensure,
  type PractitionerLicence,
} from "@workspace/db";
import { sendStaffInviteEmail } from "@workspace/mailer";
import {
  badRequest,
  HttpError,
  parseBody,
  parseId,
  parseQuery,
  requireRow,
} from "../lib/http";
import { currentUser } from "../middleware/require-auth";
import { createPasswordReset, normaliseEmail, PASSWORD_RESET_TTL_MS } from "../lib/auth";
import {
  grantPlatformAdmin,
  isPlatformAdmin,
  listPlatformAdmins,
  revokePlatformAdmin,
} from "../lib/platform-auth";
import { seedTimelineTemplate } from "../lib/timeline";
import { seedPolicyPrompts } from "../lib/storefront";
import { logger } from "../lib/logger";
import {
  createGroupCheckoutSession,
  isBillingConfigured,
} from "../lib/billing";

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
 *
 * And one rule about what it may do at all: a platform admin can create a
 * home and suspend a home. That is the complete list of writes that touch a
 * tenant. There is no route here that edits a case, an obituary, a
 * photograph, a message or a family contact, there is no business reason for
 * one, and the compliance reason against it is in Section 2 of `COLORADO.md`
 * — we are the processor, the home is the controller, and a processor that
 * can quietly rewrite a family's obituary is not a processor.
 */

const router: IRouter = Router();

/* ------------------------------------------------------------- the gate -- */

type PlatformActor = { email: string };

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
 *    because inventing a second role system is exactly what `TEAM-SPLIT.md`
 *    says not to do.
 *
 * The 403 says nothing about why. A director who mistypes a URL learns that
 * the route is not theirs, and learns nothing about whether an admin console
 * exists, who is on it, or how one gets there.
 */
const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const user = currentUser(req);

      if (!(await isPlatformAdmin(user.email))) {
        throw new HttpError(403, "Not found");
      }

      req.platformActor = { email: normaliseEmail(user.email) };
      next();
    } catch (error) {
      next(error);
    }
  })();
};

router.use("/admin", requirePlatformAdmin);

/** Narrowing helper, the same shape as `currentUser` and for the same reason. */
function actor(req: { platformActor?: PlatformActor }): PlatformActor {
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
const AUDIT_ACTIONS = [
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
] as const;
type AuditAction = (typeof AUDIT_ACTIONS)[number];

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
async function recordPlatformAccess(
  who: PlatformActor,
  action: AuditAction,
  subject: { id: number; name: string } | null,
  detail?: string,
): Promise<void> {
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
const customerHomes = eq(funeralHomesTable.internalAccount, false);

/* ------------------------------------------- the cross-tenant helpers -- */

/**
 * Below this line, every function reads rows belonging to homes other than
 * the caller's own. They all take the actor, they all audit, and they are all
 * named so that a reviewer scanning a diff can see one being called.
 */

/** One home, by the id in the URL. The only lookup that accepts an id. */
async function platformLoadHome(
  who: PlatformActor,
  homeId: number,
  action: AuditAction = "home.open",
  detail?: string,
): Promise<FuneralHome> {
  const [row] = await db
    .select()
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.id, homeId))
    .limit(1);

  const home = requireRow(row, "That home could not be found.");
  await recordPlatformAccess(who, action, home, detail);
  return home;
}

/** The customer list. Names and account state only — no case ever loads here. */
async function platformListHomes(
  who: PlatformActor,
  options: { search?: string | undefined; limit: number; offset: number },
): Promise<{ homes: FuneralHome[]; total: number }> {
  const search = options.search?.trim();
  const filter = search
    ? or(
        ilike(funeralHomesTable.name, `%${search}%`),
        ilike(funeralHomesTable.slug, `%${search}%`),
      )
    : undefined;

  const scoped = filter ? and(customerHomes, filter) : customerHomes;

  const homes = await db
    .select()
    .from(funeralHomesTable)
    .where(scoped)
    .orderBy(asc(funeralHomesTable.name))
    .limit(options.limit)
    .offset(options.offset);

  const [totals] = await db
    .select({ total: count() })
    .from(funeralHomesTable)
    .where(scoped);

  await recordPlatformAccess(
    who,
    "homes.list",
    null,
    search ? `searched for "${search}"` : `${homes.length} homes listed`,
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
async function platformEngagementFor(
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
      active: sql<number>`count(*) filter (where ${casesTable.status} <> 'closed')`.mapWith(Number),
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
      opened: sql<number>`count(*) filter (where ${familyContactsTable.firstSeenAt} is not null)`.mapWith(Number),
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
      consented: sql<number>`count(*) filter (where ${aftercareEnrollmentsTable.consentedAt} is not null)`.mapWith(Number),
      unsubscribed: sql<number>`count(*) filter (where ${aftercareEnrollmentsTable.unsubscribedAt} is not null)`.mapWith(Number),
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

type Engagement = {
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
async function platformLicensureFor(homeId: number): Promise<{
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
function toAdminHome(home: FuneralHome) {
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
    canOpenCases: canOpenCases(home),
    suspendedAt: home.suspendedAt,
    suspendedReason: home.suspendedReason,
    internalAccount: home.internalAccount,
    onboardingDone: home.onboardingDone
      .split(",")
      .map((step) => step.trim())
      .filter(Boolean),
    createdAt: home.createdAt,
  };
}

/* ----------------------------------------------------------- the routes -- */

const ListHomesQuery = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get("/admin/homes", async (req, res) => {
  const who = actor(req);
  const options = parseQuery(ListHomesQuery, req.query);

  const { homes, total } = await platformListHomes(who, options);
  const engagement = await platformEngagementFor(homes.map((home) => home.id));

  res.json({
    total,
    homes: homes.map((home) => ({
      ...toAdminHome(home),
      engagement: engagement.get(home.id)!,
    })),
  });
});

/**
 * Open a new home.
 *
 * "From a blank template" means the home is usable the moment somebody signs
 * in: it has the standard schedule every other home starts with, the default
 * office hours, and a trial that has an end date rather than an implied
 * forever. What it does not have is invented content — an empty catalogue and
 * an empty vendor directory are the honest starting state, and filling them
 * with plausible-looking placeholders is how a director ends up showing a
 * family a casket the home does not sell.
 */
const CreateHomeBody = z.object({
  name: z.string().trim().min(1).max(160),
  ownerEmail: z.string().trim().email().max(254).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  timezone: z.string().trim().max(60).optional(),
});

/**
 * Lifted from `auth/register`, which owns the canonical version. Duplicated
 * rather than shared because that one lives in Component 1's file and the two
 * will merge there when the spec split lands.
 *
 * TODO(C1): import `uniqueSlug` from Component 1's `routes/auth.ts`.
 */
async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "home";

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: funeralHomesTable.id })
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.slug, candidate))
      .limit(1);

    if (!taken) return candidate;
  }

  throw new HttpError(500, "Could not allocate a unique name for this home");
}

router.post("/admin/homes", async (req, res) => {
  const who = actor(req);
  const values = parseBody(CreateHomeBody, req.body);

  if (values.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: values.timezone });
    } catch {
      throw badRequest(`"${values.timezone}" is not a timezone this server knows.`);
    }
  }

  const ownerEmail = values.ownerEmail ? normaliseEmail(values.ownerEmail) : null;

  if (ownerEmail) {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, ownerEmail))
      .limit(1);

    if (existing) {
      throw badRequest("That email address is already in use.");
    }
  }

  const slug = await uniqueSlug(values.name);

  const { home, ownerId } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(funeralHomesTable)
      .values({
        name: values.name,
        slug,
        city: values.city ?? null,
        region: values.region ?? null,
        phone: values.phone ?? null,
        ...(values.timezone ? { timezone: values.timezone } : {}),
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      })
      .returning();

    await seedTimelineTemplate(created!.id, tx);

    // A home Heather opens gets exactly what a home that signed itself up
    // gets. Seeding in one place and not the other is how two kinds of
    // customer quietly diverge.
    await seedPolicyPrompts(created!.id, tx);

    // No password, ever, from here. The owner sets one through the ordinary
    // single-use link, the same as any other invited colleague — a platform
    // admin who could type a funeral home's first password would be a
    // platform admin who could sign in as them.
    let createdOwnerId: number | null = null;
    if (ownerEmail) {
      const [owner] = await tx
        .insert(usersTable)
        .values({
          funeralHomeId: created!.id,
          email: ownerEmail,
          passwordHash: null,
          role: "owner",
        })
        .returning({ id: usersTable.id });
      createdOwnerId = owner!.id;
    }

    return { home: created!, ownerId: createdOwnerId };
  });

  await recordPlatformAccess(
    who,
    "home.create",
    home,
    ownerEmail ? "with an owner invited" : "with nobody invited yet",
  );

  let inviteLink: string | null = null;

  if (ownerId !== null && ownerEmail !== null) {
    const token = await createPasswordReset(ownerId);
    const base = process.env["CONSOLE_URL"]?.replace(/\/+$/, "") ?? "";
    inviteLink = `${base}/reset-password?invited=1&token=${encodeURIComponent(token)}`;

    try {
      await sendStaffInviteEmail({
        to: ownerEmail,
        homeName: home.name,
        invitedBy: who.email,
        inviteLink,
        expiresInMinutes: Math.round(PASSWORD_RESET_TTL_MS / 60000),
      });
    } catch (err) {
      // The home exists and the link is about to be handed back on screen,
      // so a mail server having a bad morning is not a reason to fail a
      // request that already did the thing it was asked to do.
      logger.warn({ err, homeId: home.id }, "Could not send the owner's invitation");
    }
  }

  res.status(201).json({
    ...toAdminHome(home),
    engagement: (await platformEngagementFor([home.id])).get(home.id)!,
    // Shown once. A funeral home on a shared mail host does not reliably
    // receive anything, and the alternative to handing this over is a phone
    // call that starts with "check your spam folder".
    inviteLink,
  });
});

router.get("/admin/homes/:homeId", async (req, res) => {
  const who = actor(req);
  const home = await platformLoadHome(who, parseId(req.params.homeId));

  const { licensure, practitioners } = await platformLicensureFor(home.id);
  const engagement = await platformEngagementFor([home.id]);

  const staff = await db
    .select({
      id: usersTable.id,
      displayName: usersTable.displayName,
      title: usersTable.title,
      role: usersTable.role,
      deactivatedAt: usersTable.deactivatedAt,
      lastInvitedAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.funeralHomeId, home.id))
    .orderBy(asc(usersTable.displayName), asc(usersTable.id));

  res.json({
    ...toAdminHome(home),
    engagement: engagement.get(home.id)!,
    licensure,
    practitioners,
    reminders: licensureReminders(licensure, practitioners),
    // Names and roles. Not email addresses: knowing who works at a customer
    // is account management, and reading their inboxes' way in is not.
    staff,
  });
});

/* ------------------------------------------------------------- suspend -- */

const SuspensionBody = z.object({
  suspended: z.boolean(),
  reason: z.string().trim().max(400).optional(),
});

/**
 * Suspend a home, or let it go again.
 *
 * The one destructive thing in the console, and it is deliberately the
 * smallest destructive thing that does the job: no new cases. Everything
 * already in the home stays readable — a family part-way through uploading
 * photographs of their mother does not lose them because the home stopped
 * paying, and a director does not lose Thursday's funeral because of a
 * decision made at the platform on Wednesday.
 */
router.put("/admin/homes/:homeId/suspension", async (req, res) => {
  const who = actor(req);
  const values = parseBody(SuspensionBody, req.body);
  const homeId = parseId(req.params.homeId);

  if (values.suspended && !values.reason) {
    throw badRequest("Please say why this home is being suspended.");
  }

  const home = await platformLoadHome(
    who,
    homeId,
    values.suspended ? "home.suspend" : "home.restore",
    values.reason,
  );

  const [updated] = await db
    .update(funeralHomesTable)
    .set({
      suspendedAt: values.suspended ? (home.suspendedAt ?? new Date()) : null,
      suspendedReason: values.suspended ? (values.reason ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();

  res.json(toAdminHome(updated!));
});

/* ----------------------------------------------------------- licensure -- */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Please give a date as YYYY-MM-DD");

const LicensureBody = z.object({
  doraRegistrationNumber: z.string().trim().max(60).nullish(),
  registeredServices: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
  designeeName: z.string().trim().max(160).nullish(),
  designeeTitle: z.string().trim().max(160).nullish(),
  beganBusinessOn: isoDate.nullish(),
  registrationRenewsOn: isoDate.nullish(),
  servicesChangedOn: isoDate.nullish(),
  amendmentFiledOn: isoDate.nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

router.put("/admin/homes/:homeId/licensure", async (req, res) => {
  const who = actor(req);
  const values = parseBody(LicensureBody, req.body);
  const home = await platformLoadHome(
    who,
    parseId(req.params.homeId),
    "home.licensure.update",
  );

  // Upserted rather than created-then-updated: there is exactly one row per
  // home, and the first time anyone types a registration number is not a
  // different operation from the second time.
  const [saved] = await db
    .insert(homeLicensureTable)
    .values({ funeralHomeId: home.id, ...values })
    .onConflictDoUpdate({
      target: homeLicensureTable.funeralHomeId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();

  const practitioners = (await platformLicensureFor(home.id)).practitioners;

  res.json({
    licensure: saved!,
    practitioners,
    reminders: licensureReminders(saved!, practitioners),
  });
});

const PractitionerBody = z.object({
  personName: z.string().trim().min(1).max(160),
  role: z.enum(PRACTITIONER_ROLES),
  standing: z.enum(LICENCE_STANDINGS),
  licenceNumber: z.string().trim().max(60).nullish(),
  expiresOn: isoDate.nullish(),
});

router.post("/admin/homes/:homeId/practitioners", async (req, res) => {
  const who = actor(req);
  const values = parseBody(PractitionerBody, req.body);
  const home = await platformLoadHome(
    who,
    parseId(req.params.homeId),
    "home.practitioner.update",
    `added ${values.personName}`,
  );

  const [created] = await db
    .insert(practitionerLicencesTable)
    .values({ funeralHomeId: home.id, ...values })
    .returning();

  res.status(201).json(created!);
});

/**
 * Load a practitioner row *and* prove it belongs to the home named in the
 * path. Scoping on both is the same discipline as every staff route, and it
 * matters more here, not less: the id in the URL is the only thing stopping
 * an edit meant for one customer landing on another.
 */
async function loadPractitioner(homeId: number, rawId: string | undefined) {
  const [row] = await db
    .select()
    .from(practitionerLicencesTable)
    .where(
      and(
        eq(practitionerLicencesTable.id, parseId(rawId)),
        eq(practitionerLicencesTable.funeralHomeId, homeId),
      ),
    )
    .limit(1);

  return requireRow(row, "That person could not be found at this home.");
}

router.put("/admin/homes/:homeId/practitioners/:licenceId", async (req, res) => {
  const who = actor(req);
  const values = parseBody(PractitionerBody, req.body);
  const home = await platformLoadHome(
    who,
    parseId(req.params.homeId),
    "home.practitioner.update",
    `updated ${values.personName}`,
  );

  const existing = await loadPractitioner(home.id, req.params.licenceId);

  const [updated] = await db
    .update(practitionerLicencesTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(practitionerLicencesTable.id, existing.id))
    .returning();

  res.json(updated!);
});

router.delete("/admin/homes/:homeId/practitioners/:licenceId", async (req, res) => {
  const who = actor(req);
  const home = await platformLoadHome(
    who,
    parseId(req.params.homeId),
    "home.practitioner.update",
    "removed a practitioner",
  );

  const existing = await loadPractitioner(home.id, req.params.licenceId);

  await db
    .delete(practitionerLicencesTable)
    .where(eq(practitionerLicencesTable.id, existing.id));

  res.status(204).end();
});

/* ------------------------------------------------------------ overview -- */

/**
 * The first screen. Answers, in order, the three questions Heather actually
 * has: how many customers are there, which of them is about to have a
 * problem with DORA, and is anybody stuck.
 */
router.get("/admin/overview", async (req, res) => {
  const who = actor(req);

  const [totals] = await db
    .select({
      homes: count(),
      suspended: sql<number>`count(*) filter (where ${funeralHomesTable.suspendedAt} is not null)`.mapWith(Number),
      paying: sql<number>`count(*) filter (where ${funeralHomesTable.subscriptionStatus} = 'active')`.mapWith(Number),
      onTrial: sql<number>`count(*) filter (where ${funeralHomesTable.subscriptionStatus} = 'trial')`.mapWith(Number),
    })
    .from(funeralHomesTable)
    .where(customerHomes);

  // Every home that has any licensure record at all, with its people. Small
  // by construction — this is a list of customers, not of cases.
  const homes = await db
    .select()
    .from(funeralHomesTable)
    .where(customerHomes)
    .orderBy(asc(funeralHomesTable.name));

  const licensure = await db.select().from(homeLicensureTable);
  const practitioners = await db.select().from(practitionerLicencesTable);

  const licensureByHome = new Map(
    licensure.map((row) => [row.funeralHomeId, row]),
  );
  const practitionersByHome = new Map<number, PractitionerLicence[]>();
  for (const row of practitioners) {
    const list = practitionersByHome.get(row.funeralHomeId) ?? [];
    list.push(row);
    practitionersByHome.set(row.funeralHomeId, list);
  }

  const attention = homes
    .map((home) => ({
      home: toAdminHome(home),
      reminders: licensureReminders(
        licensureByHome.get(home.id) ?? null,
        practitionersByHome.get(home.id) ?? [],
      ).filter((reminder) => reminder.standing !== "ahead"),
    }))
    .filter((entry) => entry.reminders.length > 0);

  const engagement = await platformEngagementFor(homes.map((home) => home.id));

  const platformTotals = {
    casesOpened: 0,
    familyLinksCreated: 0,
    familyLinksOpened: 0,
    photographs: 0,
    aftercareEnrolled: 0,
    aftercareConsented: 0,
  };

  for (const entry of engagement.values()) {
    platformTotals.casesOpened += entry.casesOpened;
    platformTotals.familyLinksCreated += entry.familyLinksCreated;
    platformTotals.familyLinksOpened += entry.familyLinksOpened;
    platformTotals.photographs += entry.photographs;
    platformTotals.aftercareEnrolled += entry.aftercareEnrolled;
    platformTotals.aftercareConsented += entry.aftercareConsented;
  }

  await recordPlatformAccess(
    who,
    "platform.overview",
    null,
    `${homes.length} homes`,
  );

  res.json({ homes: totals, engagement: platformTotals, attention });
});

/* ---------------------------------------------------------- the log -- */

const AuditQuery = z.object({
  homeId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * The log, readable by the people it is a record of.
 *
 * Not because that makes it tamper-proof — it does not — but because a log
 * nobody can see is a log nobody checks, and the first person who should
 * notice an odd pattern of access is the person who runs the platform.
 *
 * Reading the log is the one thing under `/admin` that does not itself write
 * a line. It reads no home's data — only the record of earlier reads — and a
 * log that grew every time somebody scrolled it would bury the entries that
 * matter under entries about looking.
 */
/* ---------------------------------------------- who may look at all this -- */

/**
 * The list itself, readable from the console.
 *
 * Deliberately readable by every platform admin rather than by some senior
 * subset: there is one capability here and no hierarchy, and a list of who can
 * see customers' data that only some of those people may read is a worse
 * arrangement than one everybody can check.
 *
 * Audited like any other cross-tenant read. It names no home, so the subject is
 * null — but "who looked at the access list" is exactly the sort of question the
 * log exists to answer.
 */
router.get("/admin/admins", async (req, res) => {
  const who = actor(req);
  const admins = await listPlatformAdmins();

  await recordPlatformAccess(
    who,
    "platform.admins.list",
    null,
    `${admins.filter((row) => row.revokedAt === null).length} active`,
  );

  res.json(
    admins.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      note: row.note,
      addedByEmail: row.addedByEmail,
      revokedAt: row.revokedAt,
      revokedByEmail: row.revokedByEmail,
      createdAt: row.createdAt,
    })),
  );
});

const GrantAdminBody = z.object({
  email: z.string().trim().email().max(320),
  displayName: z.string().trim().max(120).optional(),
  note: z.string().trim().max(400).optional(),
});

/**
 * Add somebody to the list.
 *
 * Note what this does *not* do: create an account, send an invitation, or grant
 * anything by itself. It records that if an account with this address signs in,
 * it may use this console. Someone named here with no staff account still
 * cannot get in, which is the property that lets access be arranged before a
 * new colleague's first day without opening anything early.
 */
router.post("/admin/admins", async (req, res) => {
  const who = actor(req);
  const values = parseBody(GrantAdminBody, req.body);

  const granted = await grantPlatformAdmin({
    email: values.email,
    displayName: values.displayName ?? null,
    note: values.note ?? null,
    addedByEmail: who.email,
  });

  await recordPlatformAccess(
    who,
    "platform.admin.grant",
    null,
    `granted ${granted.email}`,
  );

  logger.warn(
    { actor: who.email, granted: granted.email },
    "Platform admin access granted",
  );

  res.status(201).json({
    id: granted.id,
    email: granted.email,
    displayName: granted.displayName,
    note: granted.note,
    addedByEmail: granted.addedByEmail,
    revokedAt: granted.revokedAt,
    revokedByEmail: granted.revokedByEmail,
    createdAt: granted.createdAt,
  });
});

/**
 * Take somebody off it.
 *
 * You cannot revoke yourself. Not for safety — a platform admin who wants out
 * can be removed by a colleague — but because the alternative is a console with
 * nobody in it and no way back except a redeploy, which is the exact failure the
 * environment variable used to cause. The same reasoning guards a home owner
 * deactivating their own account in `routes/home.ts`.
 */
router.delete("/admin/admins/:email", async (req, res) => {
  const who = actor(req);
  const email = normaliseEmail(decodeURIComponent(req.params.email ?? ""));

  if (!email) throw badRequest("Which address should be removed?");

  if (email === who.email) {
    throw badRequest(
      "You cannot remove your own access. Ask another platform admin to do it.",
    );
  }

  const revoked = await revokePlatformAdmin({
    email,
    revokedByEmail: who.email,
  });

  if (!revoked) {
    throw badRequest("That address is not on the list.");
  }

  await recordPlatformAccess(
    who,
    "platform.admin.revoke",
    null,
    `revoked ${email}`,
  );

  logger.warn(
    { actor: who.email, revoked: email },
    "Platform admin access revoked",
  );

  res.status(204).end();
});

/* ------------------------------------------------- ours, not a customer's -- */

const InternalBody = z.object({ internalAccount: z.boolean() });

/**
 * Mark a home as ours, or as a customer's.
 *
 * An internal home leaves the customer list, the counts and the engagement
 * figures, and changes in no other way — it opens cases, texts families and
 * prints orders of service exactly as any other tenant does, which is what
 * makes it useful for trying something before a real home sees it.
 *
 * This is a write that touches a tenant, so it joins suspension on the short
 * list of them. It cannot lose anybody any data: the only thing it changes is
 * whether the row appears in figures the vendor makes about itself.
 */
router.put("/admin/homes/:homeId/internal", async (req, res) => {
  const who = actor(req);
  const values = parseBody(InternalBody, req.body);
  const homeId = parseId(req.params.homeId);

  const home = await platformLoadHome(
    who,
    homeId,
    "home.internal.update",
    values.internalAccount ? "marked ours" : "marked a customer's",
  );

  const [updated] = await db
    .update(funeralHomesTable)
    .set({ internalAccount: values.internalAccount, updatedAt: new Date() })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();

  res.json(toAdminHome(updated!));
});

router.get("/admin/audit", async (req, res) => {
  const options = parseQuery(AuditQuery, req.query);

  const rows = await db
    .select()
    .from(platformAuditTable)
    .where(
      options.homeId
        ? eq(platformAuditTable.subjectHomeId, options.homeId)
        : undefined,
    )
    .orderBy(desc(platformAuditTable.createdAt), desc(platformAuditTable.id))
    .limit(options.limit);

  res.json(rows);
});

/* ------------------------------------------------------------- groups -- */

/**
 * Funeral-home groups: one contract, many locations.
 *
 * This lives in the platform console rather than in any home's own console,
 * and that is the right place for it. A group contract is negotiated by a
 * person at this end talking to a person who owns forty funeral homes; it is
 * not something a director at one branch should be able to create by
 * clicking about in their settings.
 *
 * Every route here audits, like everything else under `/admin`, though these
 * read less than the rest of the console does: a group row holds a name, a
 * Stripe id and a status, and no family has ever appeared in one.
 */

/** How long a location gets to arrange its own billing after leaving a group. */
const GROUP_EXIT_GRACE_DAYS = 14;

async function uniqueGroupSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "group";

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: homeGroupsTable.id })
      .from(homeGroupsTable)
      .where(eq(homeGroupsTable.slug, candidate))
      .limit(1);

    if (!taken) return candidate;
  }

  throw new HttpError(500, "Could not allocate a unique name for this group.");
}

/**
 * A group as the console sees it. Hand-built for the same reason
 * `toAdminHome` is: a column added to `home_groups` should not widen this
 * by accident.
 */
function toAdminGroup(group: HomeGroup, locations: number) {
  return {
    id: group.id,
    name: group.name,
    slug: group.slug,
    locations,
    subscriptionStatus: group.subscriptionStatus,
    trialEndsAt: group.trialEndsAt,
    currentPeriodEndsAt: group.currentPeriodEndsAt,
    hasSubscription: group.stripeSubscriptionId !== null,
    entitlements: group.entitlements
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    createdAt: group.createdAt,
  };
}

async function locationCounts(
  groupIds: number[],
): Promise<Map<number, number>> {
  if (groupIds.length === 0) return new Map();

  const rows = await db
    .select({ groupId: funeralHomesTable.groupId, total: count() })
    .from(funeralHomesTable)
    .where(inArray(funeralHomesTable.groupId, groupIds))
    .groupBy(funeralHomesTable.groupId);

  return new Map(
    rows.flatMap((row) => (row.groupId === null ? [] : [[row.groupId, row.total]])),
  );
}

router.get("/admin/groups", async (req, res) => {
  const who = actor(req);
  await recordPlatformAccess(who, "group.list", null);

  const groups = await db
    .select()
    .from(homeGroupsTable)
    .orderBy(asc(homeGroupsTable.name));

  const counts = await locationCounts(groups.map((group) => group.id));

  res.json(
    groups.map((group) => toAdminGroup(group, counts.get(group.id) ?? 0)),
  );
});

const CreateGroupBody = z.object({
  name: z.string().trim().min(1).max(160),
});

router.post("/admin/groups", async (req, res) => {
  const who = actor(req);
  const { name } = parseBody(CreateGroupBody, req.body);

  const [created] = await db
    .insert(homeGroupsTable)
    .values({
      name,
      slug: await uniqueGroupSlug(name),
      // A group starts on the same trial a single home gets. Nobody signs a
      // forty-location contract without trying it on one of them first.
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    })
    .returning();

  await recordPlatformAccess(who, "group.create", null, `Created group "${name}"`);

  res.status(201).json(toAdminGroup(created!, 0));
});

async function loadGroup(who: PlatformActor, raw: string | undefined) {
  const [group] = await db
    .select()
    .from(homeGroupsTable)
    .where(eq(homeGroupsTable.id, parseId(raw)))
    .limit(1);

  const row = requireRow(group, "That group could not be found.");
  await recordPlatformAccess(who, "group.open", null, `Opened group "${row.name}"`);
  return row;
}

router.get("/admin/groups/:groupId", async (req, res) => {
  const who = actor(req);
  const group = await loadGroup(who, req.params.groupId);

  const locations = await db
    .select()
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.groupId, group.id))
    .orderBy(asc(funeralHomesTable.name));

  res.json({
    ...toAdminGroup(group, locations.length),
    addOns: ADD_ONS.map((addOn) => ({
      key: addOn.key,
      title: addOn.title,
      detail: addOn.detail,
      included: group.entitlements.split(",").includes(addOn.key),
    })),
    locations: locations.map(toAdminHome),
  });
});

const MoveHomeBody = z.object({
  /** Null takes the location back out of its group. */
  groupId: z.number().int().positive().nullable(),
});

/**
 * Move a location into a group, or out of one.
 *
 * Both directions have a trap, and both are handled here rather than left to
 * whoever is on the call with the customer.
 *
 * **In:** a home that already has its own Stripe subscription is refused.
 * Letting it join would leave the group paying a consolidated invoice while
 * the branch quietly kept paying its own, and that is discovered by somebody
 * in accounts a quarter later, which is the worst possible way for a vendor
 * to be wrong about money.
 *
 * **Out:** the location keeps working. A branch sold to an independent owner
 * on Tuesday has funerals on Wednesday, and cutting it off the moment the
 * paperwork changed would stop a family part-way through uploading
 * photographs of their mother because two companies were renegotiating. It
 * gets a fortnight to put its own card in, on a trial with a real end date.
 */
router.put("/admin/homes/:homeId/group", async (req, res) => {
  const who = actor(req);
  const { groupId } = parseBody(MoveHomeBody, req.body);
  const home = await platformLoadHome(
    who,
    parseId(req.params.homeId),
    "home.group.update",
    groupId === null ? "Removed from its group" : `Moved into group ${groupId}`,
  );

  if (groupId === null) {
    const graceEnds = new Date(
      Date.now() + GROUP_EXIT_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );

    const [updated] = await db
      .update(funeralHomesTable)
      .set({
        groupId: null,
        subscriptionStatus: "trial",
        trialEndsAt: graceEnds,
        currentPeriodEndsAt: null,
        // The group's add-ons left with the group. The live trial above is
        // what keeps aftercare running for the next fortnight, and after
        // that this location buys its own.
        entitlements: "",
        updatedAt: new Date(),
      })
      .where(eq(funeralHomesTable.id, home.id))
      .returning();

    res.json(toAdminHome(updated!));
    return;
  }

  const [group] = await db
    .select()
    .from(homeGroupsTable)
    .where(eq(homeGroupsTable.id, groupId))
    .limit(1);

  const target = requireRow(group, "That group could not be found.");

  if (home.stripeSubscriptionId !== null && home.groupId === null) {
    throw new HttpError(
      409,
      "This home has its own subscription. Cancel it in Stripe first, or " +
        "the group's contract and this one will both be charged.",
    );
  }

  const [updated] = await db
    .update(funeralHomesTable)
    .set({
      groupId: target.id,
      // Adopt the contract it is now covered by. The webhook keeps these in
      // step from here on — see `applyGroupSubscription`.
      subscriptionStatus: target.subscriptionStatus,
      trialEndsAt: target.trialEndsAt,
      currentPeriodEndsAt: target.currentPeriodEndsAt,
      entitlements: target.entitlements,
      updatedAt: new Date(),
    })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();

  res.json(toAdminHome(updated!));
});

const GroupCheckoutBody = z.object({
  returnUrl: z.string().trim().min(1).max(2048),
  email: z.string().trim().email().max(254),
  addOns: z.array(z.string().refine(isAddOnKey)).optional(),
});

/**
 * Start the group's subscription.
 *
 * The base line is quantity-per-location and the per-case line is metered
 * across the whole estate, which is the shape a rollup actually wants: one
 * invoice, one renewal date, and a volume number their finance team can
 * reconcile against their own case count.
 */
router.post("/admin/groups/:groupId/checkout", async (req, res) => {
  const who = actor(req);
  const group = await loadGroup(who, req.params.groupId);
  const body = parseBody(GroupCheckoutBody, req.body);

  if (!isBillingConfigured()) {
    throw badRequest(
      "Billing is not set up on this deployment. Nothing is being charged.",
    );
  }

  const [row] = await db
    .select({ total: count() })
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.groupId, group.id));

  const locations = row?.total ?? 0;

  if (locations === 0) {
    throw badRequest(
      "Put at least one location in this group before starting its contract.",
    );
  }

  await recordPlatformAccess(
    who,
    "group.checkout",
    null,
    `Started checkout for "${group.name}" (${locations} locations)`,
  );

  res.json({
    url: await createGroupCheckoutSession({
      group,
      email: body.email,
      returnUrl: body.returnUrl,
      addOns: body.addOns as AddOnKey[] | undefined,
      locations,
    }),
  });
});

export default router;

import {
  db,
  freeTrialEndsAt,
  funeralHomesTable,
  homeGroupsTable,
  licensureReminders,
  usersTable,
} from "@workspace/db";
import {
  isMailConfigured,
  sendPasswordResetEmail,
  sendStaffInviteEmail,
} from "@workspace/mailer";
import { and, asc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  createPasswordReset,
  INVITE_TTL_DAYS,
  INVITE_TTL_MS,
  normaliseEmail,
  PASSWORD_RESET_TTL_MS,
} from "../../lib/auth";
import {
  badRequest,
  HttpError,
  parseBody,
  parseId,
  parseQuery,
  requireRow,
} from "../../lib/http";
import { consoleUrl } from "../../lib/app-urls";
import { claimEmail } from "../../lib/email-ceiling";
import { logger } from "../../lib/logger";
import { uniqueSlug } from "../../lib/slug";
import { seedPolicyPrompts } from "../../lib/storefront";
import { seedTimelineTemplate } from "../../lib/timeline";
import {
  actor,
  HOME_STATUSES,
  PlatformActor,
  platformEngagementFor,
  platformFindHomeForChange,
  platformLicensureFor,
  platformListHomes,
  platformLoadHome,
  recordPlatformAccess,
  toAdminHome,
} from "./shared";

/** Homes: list, open, create, suspend, extend a trial, reset a locked-out director. */
const router: IRouter = Router();

/* ----------------------------------------------------------- the routes -- */

const ListHomesQuery = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  ours: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  // Spelled out rather than `z.coerce.boolean()`, which reads the string
  // "false" as true -- the one value a checkbox that was just unticked sends.
  includeInternal: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  status: z.enum(HOME_STATUSES).optional(),
  // Sorting the list, in the database. `desc` on a money or date column
  // puts the biggest or most urgent first; on `name` it is Z to A.
  sort: z.enum(["name", "plan", "amount", "dueDate"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
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
  // Phase 1 §4b — the onboarding template. Everything Heather knows when she
  // signs a home up, captured once, so the director sees it on their side and
  // she never re-types it. The commercial half (plan, billing, discount,
  // how-heard, notes) is admin-side only; see toAdminHome.
  contactName: z.string().trim().max(160).optional(),
  addressLine1: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(20).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  timezone: z.string().trim().max(60).optional(),
  subscriptionPlan: z.string().trim().max(60).optional(),
  /** Which of the plan's prices the home pays: "monthly" or "annual". */
  billingPeriod: z.enum(["monthly", "annual"]).optional(),
  billingAmountCents: z.coerce
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .optional(),
  billingStartDate: z.coerce.date().optional(),
  subscriptionDueDate: z.coerce.date().optional(),
  discount: z.string().trim().max(200).optional(),
  howHeardAboutUs: z.string().trim().max(200).optional(),
  adminNotes: z.string().trim().max(4000).optional(),
});

router.post("/admin/homes", async (req, res) => {
  const who = actor(req);
  const values = parseBody(CreateHomeBody, req.body);

  if (values.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: values.timezone });
    } catch {
      throw badRequest(
        `"${values.timezone}" is not a timezone this server knows.`,
      );
    }
  }

  const ownerEmail = values.ownerEmail
    ? normaliseEmail(values.ownerEmail)
    : null;

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
        contactName: values.contactName ?? null,
        addressLine1: values.addressLine1 ?? null,
        city: values.city ?? null,
        region: values.region ?? null,
        postalCode: values.postalCode ?? null,
        phone: values.phone ?? null,
        ...(values.timezone ? { timezone: values.timezone } : {}),
        subscriptionPlan: values.subscriptionPlan ?? null,
        billingPeriod: values.billingPeriod ?? null,
        billingAmountCents: values.billingAmountCents ?? null,
        billingStartDate: values.billingStartDate ?? null,
        subscriptionDueDate: values.subscriptionDueDate ?? null,
        discount: values.discount ?? null,
        howHeardAboutUs: values.howHeardAboutUs ?? null,
        adminNotes: values.adminNotes ?? null,
        trialEndsAt: freeTrialEndsAt(),
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

  const mailSent =
    ownerId !== null && ownerEmail !== null
      ? await sendInvitation(who, home, { id: ownerId, email: ownerEmail })
      : false;

  res.status(201).json({
    ...toAdminHome(home),
    engagement: (await platformEngagementFor([home.id])).get(home.id)!,
    mailSent,
  });
});

/**
 * Email somebody at a home the link that lets them choose their first
 * password, and say whether it actually went.
 *
 * **The link itself never comes back to the console.** It used to: creating a
 * home handed the owner's invitation link back on screen, "in case the email
 * lands in spam". But that link *is* the owner's account -- whoever opens it
 * first chooses the password -- so a platform admin holding it could sign in
 * as the owner of any home they had just created, and nothing would record
 * that they had. It goes to the owner's own inbox, the same as the reset link
 * below, and the most the console learns is whether it was sent.
 *
 * "Sent" means handed to a configured mail server. Without SMTP the mailer
 * writes the message to the log (with the token redacted) instead, and the
 * console has to say so rather than tell whoever is on the phone that an
 * invitation is on its way. A provider that accepts the message and then
 * loses it is past what this process can see.
 */
async function sendInvitation(
  who: PlatformActor,
  home: { id: number; name: string },
  person: { id: number; email: string },
): Promise<boolean> {
  // A week, not a password reset's hour: an owner is invited on a sales
  // call and opens the email days later, and a link that died in the
  // meantime is a support ticket on their first morning.
  const token = await createPasswordReset(person.id, INVITE_TTL_MS);

  try {
    await sendStaffInviteEmail({
      to: person.email,
      homeName: home.name,
      invitedBy: who.email,
      inviteLink: consoleUrl(`/reset-password?invited=1&token=${encodeURIComponent(token)}`),
      expiresInDays: INVITE_TTL_DAYS,
    });
  } catch (err) {
    // The account exists either way, so a mail server having a bad morning
    // is not a reason to fail a request that already did what it was asked.
    // It is a reason to say "not sent".
    logger.warn({ err, homeId: home.id }, "Could not send an invitation");
    return false;
  }

  return isMailConfigured();
}

const InviteOwnerBody = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().max(120).optional(),
});

/**
 * Invite an owner into a home that has nobody.
 *
 * A home created with the owner's address left blank -- a real answer when
 * the paperwork is ahead of the people -- used to be a dead end: the console
 * said "an owner has to be invited" and offered no way to invite one. This is
 * that way, and it is exactly what creating the home with an address would
 * have done: an owner account with no password, and an invitation to its own
 * inbox.
 *
 * Only while the home has no owner at all. Once it has one, adding people is
 * the home's own business, done from their console, and a vendor that could
 * add an owner to a customer's account whenever it liked could make itself
 * one.
 */
router.post("/admin/homes/:homeId/invite-owner", async (req, res) => {
  const who = actor(req);
  const values = parseBody(InviteOwnerBody, req.body);
  const home = await platformFindHomeForChange(parseId(req.params.homeId));
  const email = normaliseEmail(values.email);

  const [owner] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(eq(usersTable.funeralHomeId, home.id), eq(usersTable.role, "owner")),
    )
    .limit(1);

  if (owner) {
    throw new HttpError(
      409,
      "This home already has an owner. Anybody else is theirs to invite.",
    );
  }

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existing) {
    throw badRequest("That email address is already in use.");
  }

  // Checked, so now it is a change, and the log says so before it happens.
  await recordPlatformAccess(
    who,
    "home.owner.invite",
    home,
    "invited an owner",
  );

  const [created] = await db
    .insert(usersTable)
    .values({
      funeralHomeId: home.id,
      email,
      displayName: values.name || null,
      passwordHash: null,
      role: "owner",
    })
    .returning({ id: usersTable.id });

  const mailSent = await sendInvitation(who, home, { id: created!.id, email });

  res.status(201).json({ mailSent });
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
      // Whether they have ever set a password, and whether their address is
      // confirmed -- the two facts that explain most "I can't get in" calls
      // ("you never finished the invitation", "that address has never
      // received anything from us"). Derived booleans, so the hash itself is
      // never selected into this handler.
      hasPassword: sql<boolean>`${usersTable.passwordHash} is not null`,
      emailVerified: usersTable.emailVerified,
    })
    .from(usersTable)
    .where(eq(usersTable.funeralHomeId, home.id))
    .orderBy(asc(usersTable.displayName), asc(usersTable.id));

  // The group's name, so the page can say which contract covers this home
  // without listing every group (and auditing that) on each visit.
  const [group] = home.groupId
    ? await db
        .select({ id: homeGroupsTable.id, name: homeGroupsTable.name })
        .from(homeGroupsTable)
        .where(eq(homeGroupsTable.id, home.groupId))
        .limit(1)
    : [];

  res.json({
    ...toAdminHome(home),
    groupName: group?.name ?? null,
    engagement: engagement.get(home.id)!,
    group: group ?? null,
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

/* --------------------------------------------------------- more time -- */

const ExtendTrialBody = z.object({
  days: z.number().int().min(1).max(60),
});

/**
 * Give a home on trial more time.
 *
 * The call this is for: the owner was in hospital for a fortnight of their
 * thirty days, or the board meets on the 3rd and the trial ends on the 1st.
 * Before this the answer was a database edit, which is the kind of change
 * nobody can later say who made.
 *
 * Counted from whichever is later, today or the current end date -- so ten
 * more days on a trial with five left is fifteen, and ten more days on one
 * that ran out last week is ten from now rather than three. Sixty at most,
 * because past that it is not a trial any more, it is a discount, and a
 * discount is a conversation with a price on it.
 *
 * Refused for a home that is not on trial (a subscribed home has nothing to
 * extend, and a cancelled one needs to subscribe, not to be quietly given
 * another month) and for a home in a group, whose trial is the group's and
 * would be overwritten the next time the group's contract changed.
 */
router.post("/admin/homes/:homeId/extend-trial", async (req, res) => {
  const who = actor(req);
  const { days } = parseBody(ExtendTrialBody, req.body);
  const home = await platformFindHomeForChange(parseId(req.params.homeId));

  if (home.groupId !== null) {
    throw badRequest(
      "This home's trial belongs to its group. Change it on the group instead.",
    );
  }

  if (home.subscriptionStatus !== "trial") {
    throw badRequest("Only a home on trial can be given more trial time.");
  }

  const from = Math.max(Date.now(), home.trialEndsAt?.getTime() ?? 0);
  const trialEndsAt = new Date(from + days * 24 * 60 * 60 * 1000);

  await recordPlatformAccess(
    who,
    "home.trial.extend",
    home,
    `${days} more ${days === 1 ? "day" : "days"}, to ${trialEndsAt.toISOString().slice(0, 10)}`,
  );

  const [updated] = await db
    .update(funeralHomesTable)
    .set({
      trialEndsAt,
      // The reminders count down to the old date. Cleared, so the owner
      // hears a week before the *new* end rather than nothing at all --
      // "trial-7" already sent would otherwise stay sent.
      trialRemindersSent: "",
      updatedAt: new Date(),
    })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();

  res.json(toAdminHome(updated!));
});

/* ------------------------------------------------ a director locked out -- */

/**
 * Email somebody at a home a fresh password-reset link.
 *
 * The call this is for: a director cannot get in, the "forgot password" email
 * never arrived or was deleted, the owner is at a graveside, and they have
 * rung us. Before this the console could see their name and nothing else, so
 * the answer was "try again" -- which on a shared funeral-home mail host is
 * the answer that already failed.
 *
 * What it deliberately does **not** do is hand the link to the platform admin.
 * The link goes to the address on the account and nowhere else, exactly as the
 * account holder's own "forgot password" would send it. A console that showed
 * the link could sign in as any director at any home, which is the one thing a
 * processor must never be able to do quietly; this way the most a platform
 * admin can do is cause an email to arrive in somebody's own inbox, and the
 * log says who caused it.
 *
 * Refused for a deactivated account -- the owner took them off, and a reset
 * link is not how they come back -- and scoped on the home in the path as well
 * as the id, for the same reason `loadPractitioner` is.
 */
router.post(
  "/admin/homes/:homeId/staff/:userId/password-reset",
  async (req, res) => {
    const who = actor(req);
    const homeId = parseId(req.params.homeId);
    const userId = parseId(req.params.userId);

    /*
     * Checked first, logged second, sent third.
     *
     * The log line used to be written before the checks, so a request for
     * somebody who works at another home -- refused with a 404 -- still left
     * "Emailed a director a password reset" in the log a customer is shown.
     * The person's row is read to decide whether the request is allowed; its
     * address is used only to send to, and neither is ever returned. Nothing
     * leaves this handler, and nothing is sent, until the line is written.
     */
    const home = await platformFindHomeForChange(homeId);

    const [person] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        deactivatedAt: usersTable.deactivatedAt,
        hasPassword: sql<boolean>`${usersTable.passwordHash} is not null`,
      })
      .from(usersTable)
      .where(
        and(eq(usersTable.id, userId), eq(usersTable.funeralHomeId, home.id)),
      )
      .limit(1);

    const found = requireRow(
      person,
      "That person could not be found at this home.",
    );

    if (found.deactivatedAt !== null) {
      throw badRequest(
        "That account has been switched off by the home. Their owner can " +
          "switch it back on; a reset link will not.",
      );
    }

    /*
     * The same ceiling per address as the sign-in page's own "forgotten
     * password" form (`routes/auth.ts`), counted together with it: an
     * operator on the telephone is one more person who can ask for a
     * stranger's inbox to be filled from our domain. Unlike that form this
     * one says so -- the caller is a known operator, not an anonymous
     * visitor, and "it's on its way" would be untrue.
     */
    const kind = found.hasPassword ? "password_reset" : "staff_invitation";
    if (!(await claimEmail(found, kind))) {
      res.setHeader("retry-after", String(60 * 60));
      throw new HttpError(
        429,
        "That address has already been sent as many of these as it can have " +
          "for now. Try again in an hour, or pass on one of the links already sent.",
      );
    }

    await recordPlatformAccess(
      who,
      "home.staff.reset",
      home,
      found.hasPassword
        ? `emailed a password reset to staff #${userId}`
        : `resent the invitation to staff #${userId}`,
    );

    /*
     * Somebody who never finished their invitation gets the invitation again,
     * not a "reset your password" email for a password they never had -- which
     * reads as somebody else trying to get into their account, and gets
     * deleted. Same kind of single-use link either way, to the same inbox.
     */
    if (!found.hasPassword) {
      const mailConfigured = await sendInvitation(who, home, found);
      res.status(202).json({ mailConfigured });
      return;
    }

    const token = await createPasswordReset(found.id);

    await sendPasswordResetEmail({
      to: found.email,
      resetUrl: consoleUrl(`/reset-password?token=${encodeURIComponent(token)}`),
      expiresInMinutes: Math.round(PASSWORD_RESET_TTL_MS / 60000),
    });

    // Whether it actually left the building. Without SMTP the email is only
    // logged, and telling the person on the phone "it's on its way" would be
    // the one untrue sentence in the call.
    res.status(202).json({ mailConfigured: isMailConfigured() });
  },
);

export default router;

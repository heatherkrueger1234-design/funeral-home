import { Router, type IRouter } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  db,
  funeralHomesTable,
  usersTable,
  timelineTemplatesTable,
  uploadsTable,
  toPublicUser,
} from "@workspace/db";
import {
  UpdateHomeBody,
  InviteStaffBody,
  UpdateStaffBody,
  CreateTimelineTemplateBody,
  UpdateTimelineTemplateBody,
} from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  HttpError,
  parseBody,
  parseId,
  requireRow,
} from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import {
  createPasswordReset,
  INVITE_TTL_DAYS,
  INVITE_TTL_MS,
  normaliseEmail,
} from "../lib/auth";
import { sendStaffInviteEmail } from "@workspace/mailer";
import { templateFor, toTemplateJson } from "../lib/timeline";
import { markOnboarding } from "../lib/onboarding";

const router: IRouter = Router();

router.get("/home", (req, res) => {
  res.json(tenant(req));
});

router.put("/home", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);

  // Branding and hours are the home's shopfront and its staff's evenings.
  // Both are the owner's call, not any signed-in employee's.
  if (user.role !== "owner") {
    throw badRequest("Only an owner can change the home's settings.");
  }

  const values = assertHasUpdates(parseBody(UpdateHomeBody, req.body));

  if (values.accentColor && !/^#[0-9a-fA-F]{6}$/.test(values.accentColor)) {
    throw badRequest("An accent colour must be a hex value such as #1f4e46.");
  }

  // A timezone that Intl cannot resolve would make every office-hours
  // comparison throw, at request time, on the family's phone.
  if (values.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: values.timezone });
    } catch {
      throw badRequest(`"${values.timezone}" is not a timezone this server knows.`);
    }
  }

  /*
   * The logo has to be one of this home's own staff uploads.
   *
   * This is a raw upload id, and it is read back in two places that serve the
   * bytes: the family portal's branding and the print renderer, which inlines
   * it into every card. Unchecked, a home could name another home's upload id
   * here and have that file handed to it inside its own prayer card -- a
   * cross-tenant read through a settings field. A family's photograph (which
   * carries a case id) is refused as well: the logo is shown to every family
   * the home serves, so it must not be one family's picture.
   */
  if (values.logoUploadId != null) {
    const [logo] = await db
      .select({ id: uploadsTable.id })
      .from(uploadsTable)
      .where(
        and(
          eq(uploadsTable.id, values.logoUploadId),
          eq(uploadsTable.funeralHomeId, home.id),
          isNull(uploadsTable.caseId),
        ),
      )
      .limit(1);

    if (!logo) throw badRequest("That logo could not be found. Please upload it again.");
  }

  const [updated] = await db
    .update(funeralHomesTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();

  /*
   * The checklist follows what was actually done, not what was ticked.
   *
   * Awaited, and then the row is read again. Both halves matter, and neither
   * was true before: fired and forgotten, these two writes raced the next
   * request, so a director who set their accent colour could load Settings and
   * find the branding step still unticked — the checklist claiming the work was
   * not done, on the screen where they had just done it. And `updated` above was
   * read *before* the marks, so even awaiting them left this response carrying a
   * stale `onboardingDone`.
   *
   * Awaiting is safe: `markOnboarding` swallows and logs its own failures, so
   * the promise it returns does not reject. "Never allowed to fail the request
   * it rode in on" is kept by that try/catch rather than by dropping the
   * promise, which only ever hid the ordering.
   */
  const marks: Array<Promise<void>> = [];

  if (values.name !== undefined || values.accentColor !== undefined) {
    marks.push(markOnboarding(home.id, "branding"));
  }
  if (
    values.officeOpensMinute !== undefined ||
    values.officeClosesMinute !== undefined ||
    values.urgentPhone !== undefined
  ) {
    marks.push(markOnboarding(home.id, "hours"));
  }

  if (marks.length === 0) {
    res.json(updated);
    return;
  }

  await Promise.all(marks);

  const [reread] = await db
    .select()
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.id, home.id))
    .limit(1);

  res.json(reread ?? updated);
});

router.get("/home/staff", async (req, res) => {
  const home = tenant(req);

  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.funeralHomeId, home.id))
    .orderBy(asc(usersTable.displayName), asc(usersTable.email));

  res.json(rows.map(toPublicUser));
});

/**
 * Add a colleague.
 *
 * The account is created with no password at all, and the invitee sets one
 * through the ordinary single-use reset link. That is deliberately not the
 * obvious design -- the obvious one is for the owner to type a temporary
 * password and tell them what it is, which means a real password existing in
 * a chat message, known to two people, and usually never changed.
 */
router.post("/home/staff", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);

  if (user.role !== "owner") {
    throw new HttpError(403, "Only an owner can add people to this home.");
  }

  const values = parseBody(InviteStaffBody, req.body);
  const email = normaliseEmail(values.email);

  // Emails are unique across the whole system, not per home: somebody who
  // works at two funeral homes needs two addresses, which is the same rule
  // every other business tool has and is easier to explain than the
  // alternative.
  const [existing] = await db
    .select({ id: usersTable.id, funeralHomeId: usersTable.funeralHomeId })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existing) {
    throw badRequest(
      existing.funeralHomeId === home.id
        ? "Somebody with that email address is already at this home."
        : "That email address is already in use.",
    );
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      funeralHomeId: home.id,
      email,
      passwordHash: null,
      displayName: values.displayName?.trim() || null,
      title: values.title?.trim() || null,
      role: values.role ?? "director",
    })
    .returning();

  const token = await createPasswordReset(created!.id, INVITE_TTL_MS);
  const base = process.env["CONSOLE_URL"]?.replace(/\/+$/, "") ?? "";
  const inviteLink = `${base}/reset-password?invited=1&token=${encodeURIComponent(token)}`;

  await sendStaffInviteEmail({
    to: email,
    homeName: home.name,
    invitedBy: user.displayName ?? user.email,
    inviteLink,
    expiresInDays: INVITE_TTL_DAYS,
  });

  // Returned once, so the owner can hand it over directly when the email is
  // slow or lands in a spam folder -- which, for a funeral home on a shared
  // mail host, is most of the time.
  await markOnboarding(home.id, "staff");

  res.status(201).json({ ...toPublicUser(created!), inviteLink });
});

/**
 * Send the invitation again.
 *
 * The link above lasts a week, which covers the colleague who reads their
 * email late, but not the one whose invitation went to spam, got deleted, or
 * sat unopened through a fortnight's leave. Before this the only way on was
 * the "forgotten my password" page -- a true answer, and a strange thing to
 * tell a new colleague on their first day.
 * Refused once they have a password: past that point it would be a password
 * reset the owner triggered on somebody else's account, which is a different
 * thing with a different name.
 */
router.post("/home/staff/:userId/invitation", async (req, res) => {
  const home = tenant(req);
  const actor = currentUser(req);

  if (actor.role !== "owner") {
    throw new HttpError(403, "Only an owner can invite people to this home.");
  }

  const userId = parseId(req.params.userId);
  const [member] = await db
    .select()
    .from(usersTable)
    .where(
      and(eq(usersTable.id, userId), eq(usersTable.funeralHomeId, home.id)),
    )
    .limit(1);

  if (!member) {
    throw new HttpError(404, "That person isn't at this home.");
  }
  if (member.deactivatedAt) {
    throw badRequest("Restore their access first, then send the invitation.");
  }
  if (member.passwordHash !== null) {
    throw badRequest(
      "They've already chosen a password. If they've forgotten it, they can reset it from the sign-in page.",
    );
  }

  const token = await createPasswordReset(member.id, INVITE_TTL_MS);
  const base = process.env["CONSOLE_URL"]?.replace(/\/+$/, "") ?? "";
  const inviteLink = `${base}/reset-password?invited=1&token=${encodeURIComponent(token)}`;

  await sendStaffInviteEmail({
    to: member.email,
    homeName: home.name,
    invitedBy: actor.displayName ?? actor.email,
    inviteLink,
    expiresInDays: INVITE_TTL_DAYS,
  });

  res.json({ ...toPublicUser(member), inviteLink });
});

router.put("/home/staff/:userId", async (req, res) => {
  const home = tenant(req);
  const actor = currentUser(req);

  if (actor.role !== "owner") {
    throw new HttpError(403, "Only an owner can change who works here.");
  }

  const userId = parseId(req.params.userId);
  const { active, ...values } = assertHasUpdates(
    parseBody(UpdateStaffBody, req.body),
  );

  const [target] = await db
    .select()
    .from(usersTable)
    .where(
      and(eq(usersTable.id, userId), eq(usersTable.funeralHomeId, home.id)),
    )
    .limit(1);

  const found = requireRow(target, "That person could not be found.");

  // An owner locking themselves out is unrecoverable without database
  // access, so it is refused rather than confirmed.
  if (found.id === actor.id && (active === false || values.role !== undefined)) {
    throw badRequest("You can't change your own role or access.");
  }

  const [updated] = await db
    .update(usersTable)
    .set({
      ...values,
      ...(active === undefined
        ? {}
        : { deactivatedAt: active ? null : new Date() }),
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, found.id))
    .returning();

  res.json(toPublicUser(updated!));
});

/* ------------------------------------------------ the standard schedule -- */

router.get("/home/timeline-template", async (req, res) => {
  const home = tenant(req);
  res.json((await templateFor(home.id)).map(toTemplateJson));
});

router.post("/home/timeline-template", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);

  if (user.role !== "owner") {
    throw new HttpError(403, "Only an owner can change the standard schedule.");
  }

  const values = parseBody(CreateTimelineTemplateBody, req.body);
  const title = values.title.trim();
  if (!title) throw badRequest("Please say what this step is.");

  const existing = await templateFor(home.id);

  const [created] = await db
    .insert(timelineTemplatesTable)
    .values({
      funeralHomeId: home.id,
      title,
      description: values.description ?? null,
      offsetMinutes: values.offsetMinutes,
      isEvent: values.isEvent ?? false,
      anchor: values.anchor ?? "service",
      position: existing.length,
    })
    .returning();

  await markOnboarding(home.id, "schedule");

  res.status(201).json(toTemplateJson(created!));
});

async function loadTemplate(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
) {
  const home = tenant(req);
  const id = parseId(rawId);

  const [row] = await db
    .select()
    .from(timelineTemplatesTable)
    .where(
      and(
        eq(timelineTemplatesTable.id, id),
        eq(timelineTemplatesTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  return requireRow(row, "That step could not be found.");
}

router.put("/home/timeline-template/:templateId", async (req, res) => {
  const user = currentUser(req);

  if (user.role !== "owner") {
    throw new HttpError(403, "Only an owner can change the standard schedule.");
  }

  const existing = await loadTemplate(req, req.params.templateId);
  const values = assertHasUpdates(
    parseBody(UpdateTimelineTemplateBody, req.body),
  );

  const [updated] = await db
    .update(timelineTemplatesTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(timelineTemplatesTable.id, existing.id))
    .returning();

  res.json(toTemplateJson(updated!));
});

router.delete("/home/timeline-template/:templateId", async (req, res) => {
  const user = currentUser(req);

  if (user.role !== "owner") {
    throw new HttpError(403, "Only an owner can change the standard schedule.");
  }

  const existing = await loadTemplate(req, req.params.templateId);

  await db
    .delete(timelineTemplatesTable)
    .where(eq(timelineTemplatesTable.id, existing.id));

  res.status(204).end();
});

export default router;

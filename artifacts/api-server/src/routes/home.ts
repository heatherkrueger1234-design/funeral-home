import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  funeralHomesTable,
  usersTable,
  timelineTemplatesTable,
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
  normaliseEmail,
  PASSWORD_RESET_TTL_MS,
} from "../lib/auth";
import { sendStaffInviteEmail } from "../lib/mailer";
import { templateFor, toTemplateJson } from "../lib/timeline";

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

  const [updated] = await db
    .update(funeralHomesTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();

  res.json(updated);
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

  const token = await createPasswordReset(created!.id);
  const base = process.env["CONSOLE_URL"]?.replace(/\/+$/, "") ?? "";
  const inviteLink = `${base}/reset-password?token=${encodeURIComponent(token)}`;

  await sendStaffInviteEmail({
    to: email,
    homeName: home.name,
    invitedBy: user.displayName ?? user.email,
    inviteLink,
    expiresInMinutes: Math.round(PASSWORD_RESET_TTL_MS / 60000),
  });

  // Returned once, so the owner can hand it over directly when the email is
  // slow or lands in a spam folder -- which, for a funeral home on a shared
  // mail host, is most of the time.
  res.status(201).json({ ...toPublicUser(created!), inviteLink });
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
      position: existing.length,
    })
    .returning();

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

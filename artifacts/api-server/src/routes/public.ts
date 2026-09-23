import { Router, type IRouter } from "express";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import {
  aftercareEnrollmentsTable,
  canOpenCases,
  db,
  funeralHomesTable,
  intakeRequestsTable,
  usersTable,
  INTAKE_REQUESTS_PER_HOME_PER_HOUR,
  INTAKE_REQUESTS_PER_IP_PER_HOUR,
} from "@workspace/db";
import { SubmitIntakeRequestBody } from "@workspace/api-zod";
import { sendIntakeNotificationEmail } from "@workspace/mailer";
import { AFTERCARE_UNSUBSCRIBE_PURPOSE } from "@workspace/mailer/aftercare";
import { readSignedId } from "@workspace/db/crypto";
import { badRequest, notFound, parseBody, HttpError } from "../lib/http";
import { publicHome } from "../lib/storefront";
import { markOnboarding } from "../lib/onboarding";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * The front door, and the only place in this API that anyone can write to
 * without a credential of any kind.
 *
 * Paths here are relative: this router is mounted under "/public", and the
 * rate limiter in front of it is mounted on that same prefix. Mounting either
 * without the prefix would put them in front of every staff route as well —
 * which is not hypothetical, it is what the first version of this file did,
 * and the limiter sized for one grieving person filling in one form started
 * throttling directors mid-funeral.
 *
 * That is worth stating plainly because everything here is shaped by it. A
 * request cannot create a case; it cannot reach any existing case; it cannot
 * tell the person submitting it anything they did not already know. What it
 * can do is put one row in a queue a director reviews.
 */

/** Slugs are lower-case in the database, and people type URLs in any case. */
function normaliseSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Whether anybody at this home has confirmed the address they registered with.
 *
 * The one thing email verification gates, and the reason it exists.
 *
 * Registration is open — it has to be, a funeral home buying software should
 * not have to ask us for an account first — and nothing checked that the
 * address belonged to the person typing it. So anyone could register under a
 * real home's name and have a public page, at a guessable URL, collecting the
 * details of people's deaths within a minute. That page is the one thing here
 * a stranger reaches, and it is the only thing verification holds back.
 *
 * What it deliberately does not gate: signing in, opening a case, texting a
 * family, uploading a photograph, printing an order of service, exporting, or
 * anything else inside the console. A director locked out of Thursday's
 * funeral because a confirmation email went to spam would be a far worse
 * product than the one this protects against, and the same argument is made at
 * greater length about cancelled subscriptions in `routes/cases.ts`.
 *
 * Any active staff member's confirmed address counts, not only the owner's: a
 * home where the manager confirmed and the proprietor never opened their inbox
 * is a home we have plainly heard from.
 */
async function hasVerifiedStaff(funeralHomeId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.funeralHomeId, funeralHomeId),
        eq(usersTable.emailVerified, true),
        isNull(usersTable.deactivatedAt),
      ),
    )
    .limit(1);

  return row !== undefined;
}

/**
 * Find a home that is actually able to receive this.
 *
 * Four separate reasons to refuse, all answered identically with a 404: there
 * is no such home, the home has switched the public form off, the home's
 * subscription has been cancelled, or nobody there has confirmed their email
 * address. The cancelled case matters most — a cancelled home's page must not
 * keep quietly collecting the details of people's deaths into an account
 * nobody is watching — and the last is what stops the page existing at all for
 * a home nobody has heard from.
 */
async function receivingHome(slug: string) {
  const [home] = await db
    .select()
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.slug, normaliseSlug(slug)))
    .limit(1);

  if (!home) return null;
  if (!home.intakeEnabled) return null;
  if (!canOpenCases(home)) return null;
  if (!(await hasVerifiedStaff(home.id))) return null;

  return home;
}

router.get("/homes/:slug", async (req, res) => {
  const [home] = await db
    .select()
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.slug, normaliseSlug(req.params.slug ?? "")))
    .limit(1);

  // A home that exists but has stopped paying is still a real business with a
  // real telephone, and a family who reached this page needs that number. So
  // the page renders; `intakeEnabled` is reported false so the client shows
  // the phone instead of the form.
  if (!home) throw notFound("We could not find that funeral home.");

  res.json({
    ...(await publicHome(home)),
    intakeEnabled:
      home.intakeEnabled &&
      canOpenCases(home) &&
      (await hasVerifiedStaff(home.id)),
  });
});

/**
 * Per-hour ceilings, counted in the database rather than in process memory.
 *
 * The in-memory limiter in front of this survives neither a restart nor a
 * second instance, and the thing being protected is a director's queue on the
 * morning of a funeral. Two ceilings, because they stop different things: one
 * address hammering the form, and a distributed flood that no single address
 * would trip.
 */
async function assertUnderCeilings(homeId: number, ip: string): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000);

  const [counts] = await db
    .select({
      fromHome: sql<number>`count(*)::int`,
      fromIp: sql<number>`count(*) filter (where ${intakeRequestsTable.submittedFromIp} = ${ip})::int`,
    })
    .from(intakeRequestsTable)
    .where(
      and(
        eq(intakeRequestsTable.funeralHomeId, homeId),
        gte(intakeRequestsTable.createdAt, since),
      ),
    );

  const fromIp = counts?.fromIp ?? 0;
  const fromHome = counts?.fromHome ?? 0;

  if (
    fromIp >= INTAKE_REQUESTS_PER_IP_PER_HOUR ||
    fromHome >= INTAKE_REQUESTS_PER_HOME_PER_HOUR
  ) {
    throw new HttpError(
      429,
      "We have had several requests from here already. If this cannot wait, " +
        "please telephone the funeral home.",
    );
  }
}

router.post("/intake", async (req, res) => {
  const body = parseBody(SubmitIntakeRequestBody, req.body);

  /*
   * A request nobody can answer is refused before it reaches a queue.
   *
   * The form has always asked for a telephone number or an email, but only
   * the form did: this endpoint took a request with neither, which lands in
   * a director's list as a death they have been told about and cannot ring
   * back — and it is also the cheapest possible thing for a script to fill a
   * queue with. An email that is not one is the same failure, found later.
   */
  const phone = body.requesterPhone?.trim() ?? "";
  const email = body.requesterEmail?.trim() ?? "";

  if (!phone && !email) {
    throw badRequest(
      "Please leave a telephone number or an email address, so they can reach you.",
    );
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest("That email address doesn't look quite right.");
  }
  if (phone && (phone.replace(/\D/g, "").length < 7)) {
    throw badRequest("That telephone number looks too short to ring.");
  }

  const home = await receivingHome(body.homeSlug);

  if (!home) {
    throw notFound(
      "That funeral home is not taking requests through this page. Please " +
        "telephone them instead.",
    );
  }

  await assertUnderCeilings(home.id, req.ip ?? "unknown");

  /*
   * A pre-need request is about a living person, and the two fields that only
   * make sense for a death are refused rather than quietly dropped. If a
   * client is sending a date of death on a pre-need request, something has
   * gone wrong upstream of here, and the failure mode of being lenient is a
   * file that says a living person died.
   */
  if (body.kind === "pre_need" && body.dateOfDeath) {
    throw badRequest(
      "A pre-need request is for someone who is still living, so it cannot " +
        "carry a date of death.",
    );
  }

  const [saved] = await db
    .insert(intakeRequestsTable)
    .values({
      funeralHomeId: home.id,
      kind: body.kind,
      requesterName: body.requesterName.trim(),
      requesterEmail: body.requesterEmail?.trim() || null,
      requesterPhone: body.requesterPhone?.trim() || null,
      // Nobody is related to themselves. Storing "self" here would put a word
      // in the director's queue that the person never typed.
      relationship:
        body.kind === "pre_need" ? null : body.relationship?.trim() || null,
      subjectFirstName: body.subjectFirstName.trim(),
      subjectLastName: body.subjectLastName.trim(),
      dateOfDeath: body.dateOfDeath ?? null,
      note: body.note?.trim() || null,
      submittedFromIp: req.ip ?? null,
    })
    .returning();

  if (!saved) throw new HttpError(500, "The request could not be saved.");

  /*
   * The setup step for the public page ticks here rather than when a director
   * reads the URL, because a request arriving is the only thing that actually
   * proves the page is reachable from wherever they put it.
   */
  await markOnboarding(home.id, "public");

  // Best effort, and deliberately after the row is committed: a mail outage
  // must not lose a request that a grieving family believes they have sent.
  void notifyHome(home, saved.kind as "at_need" | "pre_need", saved).catch(
    (err: unknown) => {
      logger.error(
        { err, homeId: home.id, intakeId: saved.id },
        "Could not notify the home about an intake request. It is still in " +
          "their queue.",
      );
    },
  );

  res.status(202).json({
    received: true,
    kind: saved.kind,
    homeName: home.name,
    urgentPhone: home.urgentPhone,
  });
});

/* --------------------------------------------- stopping the check-ins --- */

/**
 * The unsubscribe link at the foot of every grief check-in.
 *
 * Public because it has to work a year on, from an inbox, for somebody whose
 * texted link expired months ago. What stands in for a credential is the
 * enrolment id signed under ENCRYPTION_KEY (`signId`), so a stranger cannot
 * stop anybody else's notes, and the one thing the token can do is the one
 * thing it was sent for.
 *
 * Two verbs, on purpose. Mail scanners and link previews fetch every URL in
 * a message, so a GET must never be what stops anything — it only says whose
 * notes these are, so the page can ask. The POST is what stops them, and it
 * is also the RFC 8058 one-click target a mail client's own "unsubscribe"
 * button posts to. Stopping is final, exactly as a "no" in the portal is:
 * `unsubscribedAt` is set once and nothing in this codebase clears it.
 */
async function enrolmentForStopToken(raw: unknown) {
  const token = typeof raw === "string" ? raw : "";
  const id = readSignedId(AFTERCARE_UNSUBSCRIBE_PURPOSE, token);

  // One answer for a forged token and a deleted enrolment: neither is
  // anything the person holding the link can do something about.
  const gone = () =>
    notFound(
      "We could not find these notes. They may already have been stopped, " +
        "or the funeral home can stop them for you if you telephone.",
    );

  if (id === null) throw gone();

  const [row] = await db
    .select({
      enrollment: aftercareEnrollmentsTable,
      homeName: funeralHomesTable.name,
    })
    .from(aftercareEnrollmentsTable)
    .innerJoin(
      funeralHomesTable,
      eq(funeralHomesTable.id, aftercareEnrollmentsTable.funeralHomeId),
    )
    .where(eq(aftercareEnrollmentsTable.id, id))
    .limit(1);

  if (!row) throw gone();
  return row;
}

function stopTokenFrom(req: { query: Record<string, unknown>; body?: unknown }) {
  const fromBody = (req.body as { token?: unknown } | undefined)?.token;
  return typeof req.query["token"] === "string" ? req.query["token"] : fromBody;
}

router.get("/aftercare/unsubscribe", async (req, res) => {
  const { enrollment, homeName } = await enrolmentForStopToken(stopTokenFrom(req));

  res.json({
    homeName: enrollment.brandedAs || homeName,
    stopped: enrollment.unsubscribedAt !== null,
  });
});

router.post("/aftercare/unsubscribe", async (req, res) => {
  const { enrollment, homeName } = await enrolmentForStopToken(stopTokenFrom(req));

  if (enrollment.unsubscribedAt === null) {
    const now = new Date();
    await db
      .update(aftercareEnrollmentsTable)
      .set({ status: "done", unsubscribedAt: now, updatedAt: now })
      .where(
        and(
          eq(aftercareEnrollmentsTable.id, enrollment.id),
          isNull(aftercareEnrollmentsTable.unsubscribedAt),
        ),
      );
  }

  res.json({ homeName: enrollment.brandedAs || homeName, stopped: true });
});

async function notifyHome(
  home: typeof funeralHomesTable.$inferSelect,
  kind: "at_need" | "pre_need",
  saved: typeof intakeRequestsTable.$inferSelect,
): Promise<void> {
  let to = home.intakeNotifyEmail?.trim() || null;

  if (!to) {
    // Fall back to the owner, who is the account that registered the home and
    // is the one address guaranteed to exist.
    const [owner] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.funeralHomeId, home.id),
          eq(usersTable.role, "owner"),
        ),
      )
      .limit(1);
    to = owner?.email ?? null;
  }

  if (!to) {
    logger.warn(
      { homeId: home.id },
      "An intake request arrived for a home with no address to notify.",
    );
    return;
  }

  const consoleUrl = `${(process.env["CONSOLE_URL"] ?? "").replace(/\/+$/, "")}/requests`;

  await sendIntakeNotificationEmail({
    to,
    homeName: home.name,
    kind,
    requesterName: saved.requesterName,
    requesterPhone: saved.requesterPhone,
    requesterEmail: saved.requesterEmail,
    subjectName: `${saved.subjectFirstName} ${saved.subjectLastName}`.trim(),
    consoleUrl,
  });
}

export default router;

import { Router, type IRouter } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  canOpenCases,
  db,
  funeralHomesTable,
  intakeRequestsTable,
  toPublicFuneralHome,
  usersTable,
  INTAKE_REQUESTS_PER_HOME_PER_HOUR,
  INTAKE_REQUESTS_PER_IP_PER_HOUR,
} from "@workspace/db";
import { SubmitIntakeRequestBody } from "@workspace/api-zod";
import { sendIntakeNotificationEmail } from "@workspace/mailer";
import { badRequest, notFound, parseBody, HttpError } from "../lib/http";
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
 * Find a home that is actually able to receive this.
 *
 * Three separate reasons to refuse, all answered identically with a 404:
 * there is no such home, the home has switched the public form off, or the
 * home's subscription has been cancelled. The last one matters most — a
 * cancelled home's page must not keep quietly collecting the details of
 * people's deaths into an account nobody is watching.
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
    ...toPublicFuneralHome(home),
    intakeEnabled: home.intakeEnabled && canOpenCases(home),
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

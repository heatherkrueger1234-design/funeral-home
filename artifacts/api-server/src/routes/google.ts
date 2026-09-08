import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";
import { logger } from "../lib/logger";
import { HttpError } from "../lib/http";
import { authRateLimit } from "../middleware/rate-limit";
import { createSession, setSessionCookie } from "../lib/auth";
import {
  GoogleAuthError,
  OAUTH_STATE_COOKIE,
  authorizationUrl,
  clearState,
  exchangeCode,
  googleConfig,
  issueState,
  stateMatches,
  type GoogleProfile,
} from "../lib/google";

const router: IRouter = Router();

/**
 * Where to send the browser when the flow ends. These are full page
 * navigations from Google, not fetches, so failures have to arrive as a
 * message on a page rather than as a JSON body nobody will ever see.
 */
function appUrl(path = "/"): string {
  const base = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}

function failTo(reason: string): string {
  return appUrl(`/signin?error=${encodeURIComponent(reason)}`);
}

/**
 * Finds or creates the account behind a Google profile.
 *
 * Linking by email is the convenient behaviour and also the dangerous one: if
 * an attacker could get Google to hand over an unverified address, they would
 * be handed the matching account. So an existing account is only ever adopted
 * when Google states the address is verified.
 */
async function resolveAccount(profile: GoogleProfile): Promise<User> {
  const [byGoogleId] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.googleId, profile.sub))
    .limit(1);

  if (byGoogleId) return byGoogleId;

  const [byEmail] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, profile.email))
    .limit(1);

  if (byEmail) {
    if (!profile.emailVerified) {
      throw new GoogleAuthError(
        "Google did not confirm that address, and an account already uses it",
      );
    }

    const [linked] = await db
      .update(usersTable)
      .set({
        googleId: profile.sub,
        emailVerified: true,
        displayName: byEmail.displayName ?? profile.name,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, byEmail.id))
      .returning();

    logger.info({ userId: linked.id }, "Linked Google to an existing account");
    return linked;
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      email: profile.email,
      passwordHash: null,
      googleId: profile.sub,
      emailVerified: profile.emailVerified,
      displayName: profile.name,
    })
    .returning();

  logger.info({ userId: created.id }, "Created an account from Google");
  return created;
}

router.get("/auth/google", authRateLimit, (_req, res) => {
  const config = googleConfig();

  if (!config) {
    throw new HttpError(404, "Google sign-in is not enabled on this site");
  }

  res.redirect(authorizationUrl(config, issueState(res)));
});

router.get("/auth/google/callback", async (req, res) => {
  const config = googleConfig();

  if (!config) {
    throw new HttpError(404, "Google sign-in is not enabled on this site");
  }

  const stateCookie: unknown = req.cookies?.[OAUTH_STATE_COOKIE];
  clearState(res);

  // The person declined at Google's screen, or Google refused.
  if (typeof req.query.error === "string") {
    res.redirect(appUrl("/signin"));
    return;
  }

  if (!stateMatches(req.query.state, stateCookie)) {
    // Either a stale tab or a forged callback. Both end the same way.
    logger.warn("Google callback rejected: state did not match");
    res.redirect(failTo("google-state"));
    return;
  }

  const code = req.query.code;

  if (typeof code !== "string" || code === "") {
    res.redirect(failTo("google-code"));
    return;
  }

  try {
    const account = await resolveAccount(await exchangeCode(config, code));
    setSessionCookie(res, await createSession(account.id));
    res.redirect(appUrl("/"));
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      logger.warn({ err: { message: err.message } }, "Google sign-in failed");
      res.redirect(failTo("google-failed"));
      return;
    }

    throw err;
  }
});

export default router;

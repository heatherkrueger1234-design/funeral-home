import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  funeralHomesTable,
  usersTable,
  toPublicUser,
  type FuneralHome,
  type User,
} from "@workspace/db";
import {
  RegisterHomeBody,
  LoginBody,
  ForgotPasswordBody,
  ResetPasswordBody,
} from "@workspace/api-zod";
import { badRequest, HttpError, parseBody } from "../lib/http";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RESET_TTL_MS,
  clearSessionCookie,
  consumePasswordReset,
  createPasswordReset,
  createSession,
  destroyAllSessions,
  destroySession,
  fakeVerify,
  hashPassword,
  normaliseEmail,
  revokePasswordResets,
  setSessionCookie,
  SESSION_COOKIE,
  verifyPassword,
} from "../lib/auth";
import { sendPasswordResetEmail } from "../lib/mailer";
import { authRateLimit } from "../middleware/rate-limit";
import { currentUser, requireAuth, tenant } from "../middleware/require-auth";

/**
 * Staff accounts. Families never reach this file — they have no account at
 * all, and arrive through a link token instead (see `lib/family-link.ts`).
 */

const router: IRouter = Router();

/** The API's view of a signed-in staff member: them, and where they work. */
function authPayload(user: User, home: FuneralHome) {
  return { user: toPublicUser(user), home };
}

/**
 * A URL slug from the home's name, made unique by suffixing.
 *
 * The suffix loop is bounded rather than a `while (true)`: two homes called
 * "Green Lawn" is ordinary, two hundred is a bug or an attack, and either
 * way it should fail loudly instead of spinning.
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

/**
 * Open an account. Creates the funeral home and its first owner together,
 * because neither is any use without the other and a half-finished signup
 * would leave an unreachable home row behind.
 */
router.post("/auth/register", authRateLimit, async (req, res) => {
  const values = parseBody(RegisterHomeBody, req.body);
  const email = normaliseEmail(values.email);

  if (values.password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(
      `Please choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  const homeName = values.homeName.trim();
  if (!homeName) throw badRequest("Please give the funeral home a name.");

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existing) {
    throw badRequest("There is already an account with that email address.");
  }

  const passwordHash = await hashPassword(values.password);
  const slug = await uniqueSlug(homeName);

  // One transaction: a home with no staff is unreachable, and a staff row
  // pointing at a home that failed to insert would not satisfy its own
  // foreign key anyway.
  const { user, home } = await db.transaction(async (tx) => {
    const [createdHome] = await tx
      .insert(funeralHomesTable)
      .values({ name: homeName, slug })
      .returning();

    const [createdUser] = await tx
      .insert(usersTable)
      .values({
        funeralHomeId: createdHome!.id,
        email,
        passwordHash,
        displayName: values.displayName?.trim() || null,
        role: "owner",
      })
      .returning();

    return { user: createdUser!, home: createdHome! };
  });

  setSessionCookie(res, await createSession(user.id));
  res.status(201).json(authPayload(user, home));
});

router.post("/auth/login", authRateLimit, async (req, res) => {
  const values = parseBody(LoginBody, req.body);
  const email = normaliseEmail(values.email);

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  // Burn comparable CPU when no account matched, so response timing does not
  // reveal which addresses are registered.
  if (!user?.passwordHash) {
    await fakeVerify(values.password);
    throw new HttpError(401, "That email address and password do not match.");
  }

  if (!(await verifyPassword(values.password, user.passwordHash))) {
    throw new HttpError(401, "That email address and password do not match.");
  }

  if (user.deactivatedAt !== null) {
    throw new HttpError(403, "This account is no longer active at this home.");
  }

  const [home] = await db
    .select()
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.id, user.funeralHomeId))
    .limit(1);

  if (!home) throw new HttpError(401, "That email address and password do not match.");

  setSessionCookie(res, await createSession(user.id));
  res.json(authPayload(user, home));
});

router.post("/auth/logout", async (req, res) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];

  if (typeof token === "string" && token !== "") {
    await destroySession(token);
  }

  clearSessionCookie(res);
  res.status(204).end();
});

router.get("/auth/me", requireAuth, (req, res) => {
  res.json(authPayload(currentUser(req), tenant(req)));
});

/**
 * Always 202, whether or not the address is known. Confirming which staff
 * emails exist is a free directory of a business's employees.
 */
router.post("/auth/forgot-password", authRateLimit, async (req, res) => {
  const values = parseBody(ForgotPasswordBody, req.body);
  const email = normaliseEmail(values.email);

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (user && user.deactivatedAt === null) {
    const token = await createPasswordReset(user.id);

    // The console's own origin, so the link lands on the staff sign-in app
    // rather than on the family portal.
    const base = process.env["CONSOLE_URL"]?.replace(/\/+$/, "") ?? "";

    await sendPasswordResetEmail({
      to: user.email,
      resetUrl: `${base}/reset-password?token=${encodeURIComponent(token)}`,
      expiresInMinutes: Math.round(PASSWORD_RESET_TTL_MS / 60000),
    });
  }

  res.status(202).end();
});

router.post("/auth/reset-password", authRateLimit, async (req, res) => {
  const values = parseBody(ResetPasswordBody, req.body);

  if (values.password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(
      `Please choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  const user = await consumePasswordReset(values.token);

  if (!user) {
    throw badRequest("That reset link has expired or has already been used.");
  }

  const passwordHash = await hashPassword(values.password);

  await db
    .update(usersTable)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  // Whoever was signed in elsewhere is signed out: a password reset is what
  // someone does when they think another person has their account.
  await destroyAllSessions(user.id);
  await revokePasswordResets(user.id);

  clearSessionCookie(res);
  res.status(204).end();
});

export default router;

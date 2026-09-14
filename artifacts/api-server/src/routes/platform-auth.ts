import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  platformAdminsTable,
  toPublicPlatformAdmin,
} from "@workspace/db";
import { PlatformLoginBody } from "@workspace/api-zod";
import { HttpError, parseBody } from "../lib/http";
import { fakeVerify, normaliseEmail, verifyPassword } from "../lib/auth";
import {
  PLATFORM_SESSION_COOKIE,
  clearPlatformSessionCookie,
  createPlatformSession,
  destroyPlatformSession,
  recordPlatformSignIn,
  setPlatformSessionCookie,
} from "../lib/platform-auth";
import {
  platformAdmin,
  requirePlatformAdmin,
} from "../middleware/require-platform-admin";
import { authRateLimit } from "../middleware/rate-limit";

/**
 * Signing in to the platform console — us, not a funeral home.
 *
 * Mounted above every other gate, alongside the staff `/auth` routes and for
 * the same reason: you cannot present a session cookie you do not have yet.
 * Everything else under `/admin` sits behind `requirePlatformAdmin`, and
 * Component 2 owns it.
 */

const router: IRouter = Router();

router.post("/admin/auth/login", authRateLimit, async (req, res) => {
  const body = parseBody(PlatformLoginBody, req.body);
  const email = normaliseEmail(body.email);

  const [admin] = await db
    .select()
    .from(platformAdminsTable)
    .where(eq(platformAdminsTable.email, email))
    .limit(1);

  // One message and one timing profile for "no such account", "no password
  // set" and "wrong password". Which of the three it is would tell somebody
  // probing whether an address is one of ours, and there is nothing a real
  // person can usefully do differently in any of them.
  const invalid = () => new HttpError(401, "Wrong email or password");

  if (!admin || admin.deactivatedAt !== null || admin.passwordHash === null) {
    await fakeVerify(body.password);
    throw invalid();
  }

  if (!(await verifyPassword(body.password, admin.passwordHash))) {
    throw invalid();
  }

  const token = await createPlatformSession(admin.id);
  setPlatformSessionCookie(req, res, token);

  await db
    .update(platformAdminsTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(platformAdminsTable.id, admin.id));

  recordPlatformSignIn(admin);

  res.json(toPublicPlatformAdmin(admin));
});

router.post("/admin/auth/logout", async (req, res) => {
  const token: unknown = req.cookies?.[PLATFORM_SESSION_COOKIE];

  if (typeof token === "string" && token !== "") {
    await destroyPlatformSession(token);
  }

  clearPlatformSessionCookie(res);
  res.status(204).end();
});

router.get("/admin/auth/me", requirePlatformAdmin, (req, res) => {
  res.json(toPublicPlatformAdmin(platformAdmin(req)));
});

export default router;

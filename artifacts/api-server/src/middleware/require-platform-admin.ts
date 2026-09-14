import type { RequestHandler } from "express";
import { canAdminister, type PlatformAdmin } from "@workspace/db";
import { HttpError } from "../lib/http";
import {
  PLATFORM_SESSION_COOKIE,
  resolvePlatformSession,
} from "../lib/platform-auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      platformAdmin?: PlatformAdmin;
    }
  }
}

/**
 * The gate for `/admin`. The only account in this system that may read across
 * funeral homes.
 *
 * Note what it does *not* attach: no `req.home`, no `req.user`. Handlers below
 * this gate therefore cannot call `tenant(req)` or `currentUser(req)` — both
 * throw — which means an admin route cannot accidentally be written as though
 * it were a staff route and pick up a tenant scope that isn't there. The two
 * surfaces do not share a request shape, and that is on purpose.
 */
export const requirePlatformAdmin: RequestHandler = async (req, _res, next) => {
  try {
    const unauthorized = () => new HttpError(401, "Not signed in");
    const token: unknown = req.cookies?.[PLATFORM_SESSION_COOKIE];

    if (typeof token !== "string" || token === "") throw unauthorized();

    const admin = await resolvePlatformSession(token);

    if (!admin) throw unauthorized();
    if (admin.deactivatedAt !== null) throw unauthorized();

    req.platformAdmin = admin;
    next();
  } catch (error) {
    next(error);
  }
};

export function platformAdmin(req: { platformAdmin?: PlatformAdmin }): PlatformAdmin {
  if (!req.platformAdmin) {
    throw new HttpError(500, "Route is missing platform authentication");
  }
  return req.platformAdmin;
}

/**
 * For the handful of routes that change something rather than look at it.
 *
 * `support` exists so that helping a funeral home does not require the
 * ability to suspend one. Read is the default and write is the exception,
 * which is the right way round for an account that can see everybody.
 */
export const requirePlatformOwner: RequestHandler = (req, _res, next) => {
  try {
    if (!canAdminister(platformAdmin(req))) {
      throw new HttpError(403, "This needs an owner account");
    }
    next();
  } catch (error) {
    next(error);
  }
};

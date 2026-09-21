import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, funeralHomesTable, type FuneralHome, type User } from "@workspace/db";
import { HttpError } from "../lib/http";
import { SESSION_COOKIE, resolveSession } from "../lib/auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      home?: FuneralHome;
    }
  }
}

const unauthorized = () => new HttpError(401, "Not signed in");

/**
 * Gate for every staff route.
 *
 * It attaches two things, and the second is the one that matters: the
 * funeral home, loaded from the signed-in user's own row. Handlers scope
 * their queries with `tenant(req).id` and never with a home id that arrived
 * in a path, a body or a query string. That is the entire multi-tenancy
 * story — one home must not be able to name another home's case id and get
 * a row back, and the way that is guaranteed is that the id they can name is
 * never the id that is filtered on.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token: unknown = req.cookies?.[SESSION_COOKIE];

    if (typeof token !== "string" || token === "") {
      throw unauthorized();
    }

    const user = await resolveSession(token);

    if (!user) {
      throw unauthorized();
    }

    // Someone who has left the home keeps neither their session nor their
    // access, without anyone having to remember to delete rows.
    if (user.deactivatedAt !== null) {
      throw unauthorized();
    }

    const [home] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, user.funeralHomeId))
      .limit(1);

    if (!home) {
      throw unauthorized();
    }

    req.user = user;
    req.home = home;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Narrowing helpers. `requireAuth` guarantees both, but through middleware
 * ordering that TypeScript cannot see.
 */
export function currentUser(req: { user?: User }): User {
  if (!req.user) {
    throw new HttpError(500, "Route is missing authentication");
  }
  return req.user;
}

/** The tenant. Every staff query filters on this and nothing else. */
export function tenant(req: { home?: FuneralHome }): FuneralHome {
  if (!req.home) {
    throw new HttpError(500, "Route is missing authentication");
  }
  return req.home;
}

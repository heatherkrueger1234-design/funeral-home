import type { RequestHandler } from "express";
import type { User } from "@workspace/db";
import { HttpError } from "../lib/http";
import { SESSION_COOKIE, resolveSession } from "../lib/auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const unauthorized = () => new HttpError(401, "Not signed in");

/**
 * Gate for every route that touches user data. Attaches `req.user`; routes
 * then scope their queries with `req.user.id` rather than trusting any id
 * that arrived in the request.
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

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Narrowing helper. `requireAuth` guarantees `req.user`, but it does so
 * through middleware ordering that TypeScript cannot see.
 */
export function currentUser(req: { user?: User }): User {
  if (!req.user) {
    // Reaching here means a router was mounted without `requireAuth`.
    throw new HttpError(500, "Route is missing authentication");
  }
  return req.user;
}

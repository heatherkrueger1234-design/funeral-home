import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  funeralHomesTable,
  type Case,
  type FamilyContact,
  type FuneralHome,
} from "@workspace/db";
import { HttpError } from "../lib/http";
import { resolveFamilyLink, touchLink } from "../lib/family-link";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      familyContact?: FamilyContact;
      familyCase?: Case;
      familyHome?: FuneralHome;
    }
  }
}

/**
 * The same 401 for a token that is unknown, expired, or revoked.
 *
 * Distinguishing them would tell a stranger holding a forwarded link which
 * of the three it is, and — more to the point — there is nothing useful a
 * family member can do differently in any of the three cases. The portal
 * shows one screen: ask the funeral home for a new link.
 */
const unauthorized = () =>
  new HttpError(401, "This link is no longer active. Ask the funeral home for a new one.");

/**
 * Gate for the family surface.
 *
 * The token arrives as `Authorization: Bearer <token>` — the portal reads it
 * out of the URL once and hands it to the API client. It attaches the
 * contact, their case, and the home, and every handler below scopes to
 * `familyCase(req).id`. No family route takes a case id in its path, so
 * there is no id for a handler to forget to check.
 */
export const requireFamilyLink: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const token = match?.[1]?.trim();

    if (!token) throw unauthorized();

    const session = await resolveFamilyLink(token);

    if (!session) throw unauthorized();

    const [home] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, session.case.funeralHomeId))
      .limit(1);

    if (!home) throw unauthorized();

    req.familyContact = session.contact;
    req.familyCase = session.case;
    req.familyHome = home;

    // Recording that the link was opened must never be able to fail the
    // request it was recorded on.
    void touchLink(session.contact).catch((err: unknown) => {
      req.log?.warn({ err }, "Could not record family link visit");
    });

    next();
  } catch (error) {
    next(error);
  }
};

export function familyContact(req: { familyContact?: FamilyContact }): FamilyContact {
  if (!req.familyContact) {
    throw new HttpError(500, "Route is missing family authentication");
  }
  return req.familyContact;
}

export function familyCase(req: { familyCase?: Case }): Case {
  if (!req.familyCase) {
    throw new HttpError(500, "Route is missing family authentication");
  }
  return req.familyCase;
}

export function familyHome(req: { familyHome?: FuneralHome }): FuneralHome {
  if (!req.familyHome) {
    throw new HttpError(500, "Route is missing family authentication");
  }
  return req.familyHome;
}

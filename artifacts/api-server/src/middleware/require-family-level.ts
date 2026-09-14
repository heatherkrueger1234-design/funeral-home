import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  familyContactsTable,
  atLeast,
  canAuthorize,
  type FamilyAccessLevel,
  type FamilyContact,
} from "@workspace/db";
import { HttpError } from "../lib/http";
import { verifyPassword, fakeVerify } from "../lib/auth";
import { familyCase, familyContact } from "./require-family";

/**
 * Gates for the family surface, above the link token.
 *
 * The link proves somebody was sent here. These prove they are allowed to do
 * the particular thing they are asking to do — which is a different question
 * once a case has a next of kin, a cousin adding photographs, and thirty
 * people who were given the link at the wake.
 */

/**
 * Require an access level. Use for anything a `viewing` contact should not be
 * able to do: editing the obituary, changing selections, filling in the
 * vital statistics.
 *
 * Deliberately a middleware rather than a check inside each handler. A
 * forgotten check inside a handler looks exactly like a handler that does not
 * need one; a missing middleware is visible in the route definition.
 */
export function requireFamilyLevel(required: FamilyAccessLevel): RequestHandler {
  return (req, _res, next) => {
    try {
      if (!atLeast(familyContact(req), required)) {
        // Says what is needed rather than what they are. The person reading
        // this is a family member who clicked something, not an attacker.
        throw new HttpError(
          403,
          "Whoever the funeral home has recorded as arranging the funeral " +
            "needs to do this part. They can share it with you.",
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * The strong one: for anything the home records as an *authorization*.
 *
 * Four conditions, and every one of them is doing work:
 *
 *  1. The contact is `authorizing` — they hold the right of final disposition.
 *  2. A director recorded which tier of C.R.S. 15-19-106 that was under. The
 *     software never decides this; a professional does, from documents.
 *  3. They have a password, and they just typed it. A text message can be
 *     forwarded, and a signature about burying somebody should need more than
 *     possession of a forwarded link.
 *  4. The case is not marked as disputed. Colorado sends disputes between
 *     people of equal priority to the probate court, and a third party may
 *     decline to act until it has confirmation the argument is over. Declining
 *     is the safe posture, so this makes it the automatic one.
 *
 * Component 5 mounts this in front of anything that records an authorization.
 */
export const requireFamilyAuthorization: RequestHandler = async (req, _res, next) => {
  try {
    const contact = familyContact(req);
    const row = familyCase(req);

    if (row.dispositionDisputed) {
      throw new HttpError(
        409,
        "The funeral home is confirming who is arranging this funeral. " +
          "They will be in touch before anything else is signed.",
      );
    }

    if (!canAuthorize(contact)) {
      throw new HttpError(
        403,
        "Only the person the funeral home has recorded as authorizing this " +
          "funeral can sign this, and they will need their password.",
      );
    }

    const supplied: unknown = (req.body as Record<string, unknown> | undefined)?.[
      "password"
    ];

    if (typeof supplied !== "string" || supplied === "") {
      throw new HttpError(401, "Please enter your password to sign this.");
    }

    // `canAuthorize` already proved the hash is there; this satisfies the
    // compiler and would be a 401 rather than a crash if it ever were not.
    const stored = contact.passwordHash;
    if (stored === null) {
      await fakeVerify(supplied);
      throw new HttpError(401, "Please enter your password to sign this.");
    }

    if (!(await verifyPassword(supplied, stored))) {
      throw new HttpError(401, "That password did not match.");
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Set or replace a contact's password.
 *
 * Shared by the two routes that need it — the family member choosing their
 * own, and the director setting an initial one to read out over the telephone
 * — so that the hashing and the timestamp cannot drift apart between them.
 */
export async function setFamilyPassword(
  contact: Pick<FamilyContact, "id">,
  passwordHash: string,
): Promise<void> {
  await db
    .update(familyContactsTable)
    .set({ passwordHash, passwordSetAt: new Date(), updatedAt: new Date() })
    .where(eq(familyContactsTable.id, contact.id));
}

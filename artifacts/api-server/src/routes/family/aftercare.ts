import {
  InviteFamilyRelativeBody,
  SetFamilyAftercareConsentBody,
} from "@workspace/api-zod";
import {
  aftercareEnrollmentsTable,
  caseMessagesTable,
  casesTable,
  db,
  FAMILY_INVITE_CAP,
  familyContactsTable,
} from "@workspace/db";
import { MailNotSentError, sendFamilyLinkEmail } from "@workspace/mailer";
import { and, asc, count, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { aftercareForCase, scheduleTouchpoints } from "../../lib/aftercare";
import { linkUrl, mintLink } from "../../lib/family-link";
import { badRequest, HttpError, parseBody, requireRow } from "../../lib/http";
import { isWithinOfficeHours } from "../../lib/office-hours";
import { normalisePhone } from "../../lib/sms";
import { isThreadLocked } from "../../lib/thread";
import {
  familyCase,
  familyContact,
  familyHome,
} from "../../middleware/require-family";

/** Aftercare consent and the relatives the family adds. Mounted under /family; see `index.ts`. */
const router: IRouter = Router();

/* ----------------------------------------------------------- aftercare --- */

/**
 * Say yes or no to the check-ins.
 *
 * "No" writes `unsubscribedAt` and is final — there is no re-prompt, and
 * nothing else in this codebase sets that column back to null. A grieving
 * family that has said no once must never be asked again by software.
 */
router.post("/aftercare", async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);
  const values = parseBody(SetFamilyAftercareConsentBody, req.body);

  const [existing] = await db
    .select()
    .from(aftercareEnrollmentsTable)
    .where(eq(aftercareEnrollmentsTable.contactId, contact.id))
    .limit(1);

  const found = requireRow(existing, "There is no aftercare on this case yet.");

  // "No" is final. Without this, a replayed request, a stale tab still
  // holding a "Yes, please" button, or a direct call against the family
  // token could set `unsubscribedAt` back to null and re-enrol someone who
  // has already said no — exactly what the comment above promises never
  // happens.
  if (values.consent && found.unsubscribedAt !== null) {
    // Said to the family, who are the only ones who can reach this route --
    // not the staff-facing sentence it used to be.
    throw new HttpError(
      409,
      "You've already said no to these notes, so they won't start again. " +
        "If you've changed your mind, the funeral home can help.",
    );
  }

  /*
   * A yes needs somewhere to send to.
   *
   * The check-ins are email, and a contact the home added with only a mobile
   * number is enrolled all the same. Saying yes used to succeed for them, show
   * four dates, and then fail every one of those dates in the sender with "No
   * email address" — a family promised a note on the anniversary of their
   * mother's death who silently never gets it. Now the portal asks for the
   * address alongside the yes, and a yes without one is refused here.
   */
  const email = values.email?.trim() || null;
  // A yes to texts is the family's own consent, with this number.
  const wantsSms = values.consent && values.sms === true;
  const rawPhone = values.phone?.trim() || found.phone || contact.phone || "";
  const phone = wantsSms ? normalisePhone(rawPhone) : null;

  if (values.consent) {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw badRequest("That email address doesn't look quite right.");
    }
    if (wantsSms && !phone) {
      throw badRequest("That mobile number doesn't look quite right.");
    }
    if (!email && !found.email && !wantsSms) {
      throw badRequest(
        "Please add an email address or a mobile number for the notes to go to.",
      );
    }
  }

  const now = new Date();

  const updated = await db.transaction(async (tx) => {
    const [saved] = await tx
      .update(aftercareEnrollmentsTable)
      .set(
        values.consent
          ? {
              status: "active",
              consentedAt: now,
              unsubscribedAt: null,
              ...(email ? { email } : {}),
              ...(wantsSms
                ? { phone, smsConsentAt: now }
                : { smsConsentAt: null }),
              touchpointsConsentAt: values.touchpoints === true ? now : null,
              updatedAt: now,
            }
          : { status: "done", unsubscribedAt: now, updatedAt: now },
      )
      .where(eq(aftercareEnrollmentsTable.id, found.id))
      .returning();

    if (wantsSms && !contact.smsConsentAt) {
      await tx
        .update(familyContactsTable)
        .set({
          smsConsentAt: now,
          smsConsentSource: "family_portal",
          updatedAt: now,
        })
        .where(eq(familyContactsTable.id, contact.id));
    }
    return saved;
  });

  if (values.consent && values.touchpoints === true) {
    await scheduleTouchpoints(updated!, row, familyHome(req));
  }

  const all = await aftercareForCase(row.id, row.funeralHomeId);
  res.json(
    all.find((entry) => entry.id === updated!.id) ?? {
      ...updated!,
      contactName: contact.name,
      deliveries: [],
    },
  );
});

/* ----------------------------------------------------------- relatives --- */

/**
 * Passing the link on, the way `family-contacts.ts` says it should work:
 * the family *wants* the brother in Ohio adding photographs, and `canInvite`
 * lets the next of kin give him a way in without ringing the director to key
 * in another phone number.
 *
 * Forwarding the texted link already works, and always will — but it hands
 * the brother the sister's own credential, signs his photographs with her
 * name, and cannot be stopped for him without being stopped for her. A link
 * of his own fixes all three, and is the reason this route exists.
 *
 * What it will not do, each for a reason:
 *
 *  - Invite for someone the home has not trusted to. `canInvite` is set by
 *    the director (on for the next of kin by default), and a contact without
 *    it gets a 403 rather than a quietly empty success.
 *  - Mint a link that can mint links. The new contact is a contributor with
 *    `canInvite` false; the home can widen that from the console. Otherwise
 *    one forwarded message is a chain nobody can see the end of.
 *  - Outlive the person who asked. The new link expires no later than the
 *    inviter's own, so nothing here extends anyone's access to the case.
 *  - Go on without limit. `FAMILY_INVITE_CAP` per case, counted over every
 *    family-added row including the removed ones, checked under a lock on
 *    the case so two taps at once cannot both take the last place.
 *  - Happen behind the home's back. The row records who added whom, and a
 *    note goes into the family's thread under the inviter's name, which is
 *    how everything else the family does reaches the director's inbox.
 *
 * The token is minted by `mintLink` and stored as its SHA-256 exactly like a
 * director's; the working value leaves this process once — in the text, the
 * email, or (only when neither could go) the response, to copy.
 */

type RelativeRow = typeof familyContactsTable.$inferSelect;

function toRelativeJson(row: RelativeRow) {
  return {
    id: row.id,
    name: row.name,
    relationship: row.relationship,
    phone: row.phone,
    email: row.email,
    firstSeenAt: row.firstSeenAt,
    revoked: row.revokedAt !== null,
    createdAt: row.createdAt,
  };
}

/** Everyone the family's side has added to this case, removed or not. */
async function familyInviteCount(
  caseId: number,
  executor: Pick<typeof db, "select"> = db,
): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(familyContactsTable)
    .where(
      and(
        eq(familyContactsTable.caseId, caseId),
        isNotNull(familyContactsTable.invitedByContactId),
      ),
    );
  return Number(row?.value ?? 0);
}

/** A plain check, not RFC 5322: somebody's typo, not somebody's attack. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get("/relatives", async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);

  if (!contact.canInvite) {
    res.json({
      canInvite: false,
      cap: FAMILY_INVITE_CAP,
      remaining: 0,
      relatives: [],
    });
    return;
  }

  const [mine, used] = await Promise.all([
    db
      .select()
      .from(familyContactsTable)
      .where(
        and(
          eq(familyContactsTable.caseId, row.id),
          eq(familyContactsTable.invitedByContactId, contact.id),
        ),
      )
      .orderBy(asc(familyContactsTable.createdAt)),
    familyInviteCount(row.id),
  ]);

  res.json({
    canInvite: true,
    cap: FAMILY_INVITE_CAP,
    remaining: Math.max(0, FAMILY_INVITE_CAP - used),
    relatives: mine.map(toRelativeJson),
  });
});

router.post("/relatives", async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);
  const home = familyHome(req);
  const values = parseBody(InviteFamilyRelativeBody, req.body);

  if (!contact.canInvite) {
    throw new HttpError(
      403,
      "Adding family is something the funeral home looks after for you. Please ask them, and they'll send a link.",
    );
  }

  if (row.status === "closed") {
    throw new HttpError(
      409,
      "These arrangements have been closed, so no one new can be added. The funeral home can still help.",
    );
  }

  const name = values.name.trim();
  if (!name) throw badRequest("Please give their name.");

  const relationship = values.relationship?.trim() || null;
  const rawPhone = values.phone?.trim() || "";
  const email = values.email?.trim().toLowerCase() || null;

  if (!rawPhone && !email) {
    throw badRequest(
      "Please add a mobile number or an email address, so their link has somewhere to go.",
    );
  }

  const phone = rawPhone ? normalisePhone(rawPhone) : null;
  if (rawPhone && !phone) {
    throw badRequest(
      "That mobile number doesn't look quite right. Please check it, including the country code if they're abroad.",
    );
  }
  if (email && !EMAIL_SHAPE.test(email)) {
    throw badRequest("That email address doesn't look quite right.");
  }

  const link = mintLink();
  // Never longer than the inviter's own access: passing the link on must not
  // be a way to extend it.
  const expiresAt =
    link.expiresAt < contact.expiresAt ? link.expiresAt : contact.expiresAt;

  const created = await db.transaction(async (tx) => {
    // Serialises invitations on this case, so the cap and the duplicate
    // check below are true when the insert lands, not merely when read.
    await tx
      .select({ id: casesTable.id })
      .from(casesTable)
      .where(eq(casesTable.id, row.id))
      .for("update");

    if ((await familyInviteCount(row.id, tx)) >= FAMILY_INVITE_CAP) {
      throw new HttpError(
        409,
        `Your family has added ${FAMILY_INVITE_CAP} people already, which is as many as we can add from here. The funeral home can add anyone else.`,
      );
    }

    /*
     * Somebody who already has a live link does not need a second one: two
     * links for one cousin is two things the director has to revoke, and
     * the usual reason for asking again is that the first text was missed,
     * which the home can resend.
     */
    const existing = await tx
      .select({
        name: familyContactsTable.name,
        phone: familyContactsTable.phone,
        email: familyContactsTable.email,
      })
      .from(familyContactsTable)
      .where(
        and(
          eq(familyContactsTable.caseId, row.id),
          isNull(familyContactsTable.revokedAt),
          gt(familyContactsTable.expiresAt, new Date()),
        ),
      );

    const already = existing.find(
      (other) =>
        (phone !== null &&
          other.phone !== null &&
          normalisePhone(other.phone) === phone) ||
        (email !== null && other.email?.trim().toLowerCase() === email),
    );

    if (already) {
      throw new HttpError(
        409,
        `${already.name} already has their own link. If it isn't reaching them, the funeral home can send it again.`,
      );
    }

    const [inserted] = await tx
      .insert(familyContactsTable)
      .values({
        funeralHomeId: home.id,
        caseId: row.id,
        name,
        relationship,
        phone,
        email,
        role: "contributor",
        canInvite: false,
        tokenHash: link.tokenHash,
        expiresAt,
        invitedByContactId: contact.id,
      })
      .returning();

    /*
     * The home is told the way it hears about everything else the family
     * does: in the one thread, under the name of the person who did it. Not
     * written once the thread has locked -- the row above still says who
     * added whom, and the console shows it.
     */
    if (!isThreadLocked(row)) {
      const now = new Date();
      await tx.insert(caseMessagesTable).values({
        funeralHomeId: home.id,
        caseId: row.id,
        authorContactId: contact.id,
        body: `Added ${name}${relationship ? ` (${relationship})` : ""} to the family's page, with a link of their own.`,
        sentOutsideOfficeHours: isWithinOfficeHours(home, now) ? null : now,
      });
    }

    return inserted!;
  });

  const url = linkUrl(link.token);
  /*
   * Never texted. The relative has not agreed to texts from the home — a
   * cousin typing their number is not consent — so the inviter gets a link
   * to share themselves (or it goes by email). The director can text them
   * once they have recorded consent.
   */
  const sentBySms = false;
  let sentByEmail = false;

  if (email) {
    try {
      await sendFamilyLinkEmail({
        to: email,
        homeName: home.name,
        invitedBy: contact.name,
        link: url,
        replyTo: home.intakeNotifyEmail,
      });
      sentByEmail = true;
    } catch (error) {
      if (!(error instanceof MailNotSentError)) {
        req.log?.error({ err: error }, "Relative's link email failed to send");
      }
    }
  }

  const used = await familyInviteCount(row.id);

  res.status(201).json({
    relative: toRelativeJson(created),
    sentBySms,
    sentByEmail,
    // Shown once, only when nothing else could carry it. When a text or an
    // email did go, the working link has already reached the one person it
    // is for, and a second copy on the inviter's screen is a copy of their
    // cousin's key that nobody needs.
    link: sentBySms || sentByEmail ? null : url,
    remaining: Math.max(0, FAMILY_INVITE_CAP - used),
  });
});

export default router;

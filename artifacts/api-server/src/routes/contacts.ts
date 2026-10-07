import { Router, type IRouter } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  casesTable,
  familyContactsTable,
  isLinkLive,
  toPublicFamilyContact,
  type FamilyContact,
  type Tx,
} from "@workspace/db";
import {
  CreateCaseContactBody,
  ReissueContactLinkQueryParams,
  RevokeContactQueryParams,
  SendContactLinkBody,
  SendContactLinkQueryParams,
  UpdateContactBody,
} from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  HttpError,
  parseBody,
  parseId,
  parseQuery,
  requireRow,
} from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import { linkUrl, mintLink, type MintedLink } from "../lib/family-link";
import { sendSms, smsBlockReason, SmsNotSentError } from "../lib/sms";
import { markOnboarding } from "../lib/onboarding";
import { loadCase } from "./cases";

const router: IRouter = Router();

/** The columns a director's "they agreed to texts" tick writes. */
function consentFields(consent: boolean | undefined) {
  if (consent === true) return { smsConsentAt: new Date(), smsConsentSource: "director" };
  if (consent === false) return { smsConsentAt: null, smsConsentSource: null };
  return {};
}

const NOT_A_PLAN =
  "Only a plan has a person it is for who reads it. On this file, everyone here is family.";

/**
 * Take the "person this plan is for" flag off whoever has it, so the caller
 * can give it to somebody else. A plan is about one person.
 *
 * The case row is locked first. Two directors ticking two different names in
 * the same second then take turns, and the second simply moves the flag
 * again, rather than both writes landing and the database's one-per-case
 * index refusing one of them as an error.
 */
async function releaseSubject(tx: Tx, caseId: number): Promise<void> {
  await tx
    .select({ id: casesTable.id })
    .from(casesTable)
    .where(eq(casesTable.id, caseId))
    .for("update");
  await tx
    .update(familyContactsTable)
    .set({ isSubject: false, updatedAt: new Date() })
    .where(
      and(
        eq(familyContactsTable.caseId, caseId),
        eq(familyContactsTable.isSubject, true),
      ),
    );
}

/**
 * Refuse a link for the person a file was about, once they have died.
 *
 * Their phone and their inbox are somebody else's now, and the link would
 * let that somebody post in the chat under the dead person's name. The
 * conversion to at-need already closed it (`cases.ts`); this stops one click
 * here opening it again. Whoever has the phone is added as themselves.
 */
async function assertCanHaveLink(contact: FamilyContact): Promise<void> {
  if (!contact.isSubject) return;
  const [row] = await db
    .select({ kind: casesTable.kind })
    .from(casesTable)
    .where(eq(casesTable.id, contact.caseId))
    .limit(1);
  if (row?.kind === "pre_need") return;
  throw new HttpError(
    409,
    `This is ${contact.name}'s own contact, from when the file was their plan. To give somebody in the family a link, add them as themselves.`,
  );
}

/** Load a contact, scoped to the signed-in home. */
async function loadContact(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
): Promise<FamilyContact> {
  const home = tenant(req);
  const id = parseId(rawId);

  const [row] = await db
    .select()
    .from(familyContactsTable)
    .where(
      and(
        eq(familyContactsTable.id, id),
        eq(familyContactsTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  return requireRow(row, "That contact could not be found.");
}

router.get("/cases/:caseId/contacts", async (req, res) => {
  const row = await loadCase(req, req.params.caseId);

  const contacts = await db
    .select()
    .from(familyContactsTable)
    .where(eq(familyContactsTable.caseId, row.id))
    .orderBy(asc(familyContactsTable.createdAt));

  res.json(contacts.map(toPublicFamilyContact));
});

/**
 * Add a family member and mint their link.
 *
 * This is the only response in the entire API that contains a working token.
 * The director sees it once, pastes it into a text message, and it is gone —
 * only the digest was stored. Reissuing is one click, so nothing is lost by
 * being unable to retrieve it, and a link that can be read back out of the
 * console later is a link that a departing employee can walk away with.
 */
router.post("/cases/:caseId/contacts", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const values = parseBody(CreateCaseContactBody, req.body);

  const name = values.name.trim();
  if (!name) throw badRequest("Please give this person a name.");
  if (values.isSubject && row.kind !== "pre_need") {
    throw new HttpError(409, NOT_A_PLAN);
  }

  const link = mintLink();

  const created = await db.transaction(async (tx) => {
    if (values.isSubject) await releaseSubject(tx, row.id);
    const [inserted] = await tx
      .insert(familyContactsTable)
      .values({
        funeralHomeId: home.id,
        caseId: row.id,
        name,
        relationship: values.relationship ?? null,
        phone: values.phone ?? null,
        email: values.email ?? null,
        role: values.role ?? "contributor",
        canInvite: values.canInvite ?? false,
        isSubject: values.isSubject ?? false,
        ...consentFields(values.smsConsent),
        tokenHash: link.tokenHash,
        expiresAt: link.expiresAt,
        invitedByUserId: user.id,
      })
      .returning();
    return inserted;
  });

  // Adding the first family member is what turns an intake into a live case.
  if (row.status === "intake") {
    await db
      .update(casesTable)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(casesTable.id, row.id));
  }

  await markOnboarding(home.id, "family");

  res
    .status(201)
    .json({ ...toPublicFamilyContact(created!), link: linkUrl(link.token) });
});

router.put("/contacts/:contactId", async (req, res) => {
  const existing = await loadContact(req, req.params.contactId);
  const { smsConsent, ...values } = assertHasUpdates(parseBody(UpdateContactBody, req.body));

  // Taking the flag off is always allowed; giving it is for a plan only.
  const claiming = values.isSubject === true && !existing.isSubject;
  if (claiming) {
    const [row] = await db
      .select({ kind: casesTable.kind })
      .from(casesTable)
      .where(eq(casesTable.id, existing.caseId))
      .limit(1);
    if (row?.kind !== "pre_need") throw new HttpError(409, NOT_A_PLAN);
  }

  const updated = await db.transaction(async (tx) => {
    if (claiming) await releaseSubject(tx, existing.caseId);
    const [row] = await tx
      .update(familyContactsTable)
      .set({
        ...values,
        // Recording consent again keeps the original moment it was given.
        ...(smsConsent === true && existing.smsConsentAt ? {} : consentFields(smsConsent)),
        updatedAt: new Date(),
      })
      .where(eq(familyContactsTable.id, existing.id))
      .returning();
    return row;
  });

  res.json(toPublicFamilyContact(updated!));
});

/**
 * Stop the links a contact passed on, and any passed on from those in turn.
 *
 * A director stops or replaces a link because it reached somebody it should
 * not have, and whoever was holding it may already have used it to give
 * themselves a link of their own (`POST /family/relatives`): one that the
 * remedy for the first never touched, good for the photographs, the thread
 * and the vitals for ninety days. So the remedy reaches every link that came
 * from this one, however many steps on, because the home can let a relative
 * add family too.
 *
 * Only links that still work are stopped and named, so the director is told
 * about people who lose something now. A link that was already stopped is
 * walked through rather than round: what was passed on from it came from
 * this one as well.
 *
 * Held to the contact's own case and home, under the lock `lockCase` takes:
 * `invitedByContactId` is not a foreign key, and a row anywhere else that
 * names this contact is nothing to do with them.
 */
async function stopPassedOn(
  tx: Tx,
  contact: FamilyContact,
  now: Date,
): Promise<Array<{ id: number; name: string }>> {
  const onCase = await tx
    .select()
    .from(familyContactsTable)
    .where(
      and(
        eq(familyContactsTable.caseId, contact.caseId),
        eq(familyContactsTable.funeralHomeId, contact.funeralHomeId),
      ),
    )
    .orderBy(asc(familyContactsTable.id));

  const passedOnBy = new Map<number, FamilyContact[]>();
  for (const row of onCase) {
    if (row.invitedByContactId === null) continue;
    passedOnBy.set(row.invitedByContactId, [
      ...(passedOnBy.get(row.invitedByContactId) ?? []),
      row,
    ]);
  }

  // Each row is reached once, so nothing written by hand can send this round
  // in a circle.
  const reached = new Set([contact.id]);
  const from = [contact.id];
  const stopping: FamilyContact[] = [];
  while (from.length > 0) {
    for (const row of passedOnBy.get(from.shift()!) ?? []) {
      if (reached.has(row.id)) continue;
      reached.add(row.id);
      from.push(row.id);
      if (isLinkLive(row, now)) stopping.push(row);
    }
  }
  stopping.sort((a, b) => a.id - b.id);

  if (stopping.length > 0) {
    await tx
      .update(familyContactsTable)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        inArray(
          familyContactsTable.id,
          stopping.map((row) => row.id),
        ),
      );
  }

  return stopping.map(({ id, name }) => ({ id, name }));
}

/**
 * Take the lock a family's invitation takes (`family/aftercare.ts`), so that
 * stopping a link and a relative being added from it cannot pass each other:
 * whichever goes second sees what the first did.
 */
async function lockCase(tx: Tx, caseId: number): Promise<void> {
  await tx
    .select({ id: casesTable.id })
    .from(casesTable)
    .where(eq(casesTable.id, caseId))
    .for("update");
}

/**
 * Revoke rather than delete. The photographs this person uploaded stay on the
 * case and keep their name against them; what stops is the link -- and,
 * unless the director says they are family, the links it was passed on to.
 */
router.delete("/contacts/:contactId", async (req, res) => {
  const existing = await loadContact(req, req.params.contactId);
  const { passedOn } = parseQuery(RevokeContactQueryParams, req.query);
  const now = new Date();

  const { updated, alsoStopped } = await db.transaction(async (tx) => {
    await lockCase(tx, existing.caseId);
    const [row] = await tx
      .update(familyContactsTable)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(familyContactsTable.id, existing.id))
      .returning();
    return {
      updated: row!,
      alsoStopped: passedOn === "stop" ? await stopPassedOn(tx, existing, now) : [],
    };
  });

  res.json({ ...toPublicFamilyContact(updated), alsoStopped });
});

/**
 * Put a freshly minted link on a contact, in place of the one they had, and
 * stop what the old one passed on unless the director chose to keep it.
 */
async function replaceLink(
  existing: FamilyContact,
  link: MintedLink,
  passedOn: "stop" | "keep",
  also: Partial<Pick<FamilyContact, "smsConsentAt" | "smsConsentSource">> = {},
) {
  const now = new Date();

  return db.transaction(async (tx) => {
    await lockCase(tx, existing.caseId);
    const [updated] = await tx
      .update(familyContactsTable)
      .set({
        tokenHash: link.tokenHash,
        expiresAt: link.expiresAt,
        revokedAt: null,
        ...also,
        updatedAt: now,
      })
      .where(eq(familyContactsTable.id, existing.id))
      .returning();
    return {
      updated: updated!,
      alsoStopped: passedOn === "stop" ? await stopPassedOn(tx, existing, now) : [],
    };
  });
}

/**
 * Mint a fresh link. The previous one stops working the moment this returns,
 * because the row holds exactly one digest — which is what makes this the
 * right answer to "my sister forwarded the link to someone she shouldn't
 * have". What the old link passed on stops with it (see `stopPassedOn`).
 */
router.post("/contacts/:contactId/link", async (req, res) => {
  const existing = await loadContact(req, req.params.contactId);
  const { passedOn } = parseQuery(ReissueContactLinkQueryParams, req.query);
  await assertCanHaveLink(existing);
  const link = mintLink();

  const { updated, alsoStopped } = await replaceLink(existing, link, passedOn);

  res.json({
    ...toPublicFamilyContact(updated),
    link: linkUrl(link.token),
    alsoStopped,
  });
});

/**
 * Mint a link and text it.
 *
 * A partial failure here is the normal case, not an edge case: plenty of
 * homes will not have SMS credentials on day one, and plenty of numbers a
 * director types will be landlines. So the link is always returned and `sent`
 * says what happened -- a director who is told "couldn't send" and handed the
 * link can carry on, whereas an error page leaves them with nothing on the
 * morning of an arrangement conference.
 *
 * The link is minted before the send is attempted, so a text that does go out
 * is never carrying a token that was about to be replaced.
 */
router.post("/contacts/:contactId/send-link", async (req, res) => {
  const home = tenant(req);
  const existing = await loadContact(req, req.params.contactId);

  const values = parseBody(SendContactLinkBody, req.body ?? {});
  const { passedOn } = parseQuery(SendContactLinkQueryParams, req.query);
  await assertCanHaveLink(existing);

  if (!existing.phone?.trim()) {
    throw badRequest("There is no mobile number for this person.");
  }

  const link = mintLink();

  const { updated, alsoStopped } = await replaceLink(
    existing,
    link,
    passedOn,
    values.smsConsent === true && !existing.smsConsentAt ? consentFields(true) : {},
  );

  const url = linkUrl(link.token);

  // Short, and it names the home. A link arriving from an unknown number
  // three days after a death reads like a scam unless it says who it is.
  // Opt-out wording on every link text, as carriers expect.
  const body = `${home.name}: here is your private page for the arrangements. ${url} Reply STOP to opt out.`;

  let sent = false;
  // Consent is checked on the row as saved, so a tick sent with this
  // request counts and a STOP reply always wins.
  let smsError: string | null = smsBlockReason(updated);

  if (!smsError) {
    try {
      await sendSms({ to: existing.phone, body, home });
      sent = true;
    } catch (error) {
      if (error instanceof SmsNotSentError) {
        smsError = error.message;
      } else {
        throw error;
      }
    }
  }

  res.json({
    ...toPublicFamilyContact(updated),
    link: url,
    sent,
    smsError,
    alsoStopped,
  });
});

export default router;

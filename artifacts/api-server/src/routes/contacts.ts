import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  casesTable,
  familyContactsTable,
  toPublicFamilyContact,
  type FamilyContact,
} from "@workspace/db";
import { CreateCaseContactBody, UpdateContactBody } from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  parseBody,
  parseId,
  requireRow,
} from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import { linkUrl, mintLink } from "../lib/family-link";
import { sendSms, SmsNotSentError } from "../lib/sms";
import { loadCase } from "./cases";

const router: IRouter = Router();

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

  const link = mintLink();

  const [created] = await db
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
      tokenHash: link.tokenHash,
      expiresAt: link.expiresAt,
      invitedByUserId: user.id,
    })
    .returning();

  // Adding the first family member is what turns an intake into a live case.
  if (row.status === "intake") {
    await db
      .update(casesTable)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(casesTable.id, row.id));
  }

  res
    .status(201)
    .json({ ...toPublicFamilyContact(created!), link: linkUrl(link.token) });
});

router.put("/contacts/:contactId", async (req, res) => {
  const existing = await loadContact(req, req.params.contactId);
  const values = assertHasUpdates(parseBody(UpdateContactBody, req.body));

  const [updated] = await db
    .update(familyContactsTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(familyContactsTable.id, existing.id))
    .returning();

  res.json(toPublicFamilyContact(updated!));
});

/**
 * Revoke rather than delete. The photographs this person uploaded stay on the
 * case and keep their name against them; what stops is the link.
 */
router.delete("/contacts/:contactId", async (req, res) => {
  const existing = await loadContact(req, req.params.contactId);

  await db
    .update(familyContactsTable)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(familyContactsTable.id, existing.id));

  res.status(204).end();
});

/**
 * Mint a fresh link. The previous one stops working the moment this returns,
 * because the row holds exactly one digest — which is what makes this the
 * right answer to "my sister forwarded the link to someone she shouldn't
 * have".
 */
router.post("/contacts/:contactId/link", async (req, res) => {
  const existing = await loadContact(req, req.params.contactId);
  const link = mintLink();

  const [updated] = await db
    .update(familyContactsTable)
    .set({
      tokenHash: link.tokenHash,
      expiresAt: link.expiresAt,
      revokedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(familyContactsTable.id, existing.id))
    .returning();

  res.json({ ...toPublicFamilyContact(updated!), link: linkUrl(link.token) });
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

  if (!existing.phone?.trim()) {
    throw badRequest("There is no mobile number for this person.");
  }

  const link = mintLink();

  const [updated] = await db
    .update(familyContactsTable)
    .set({
      tokenHash: link.tokenHash,
      expiresAt: link.expiresAt,
      revokedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(familyContactsTable.id, existing.id))
    .returning();

  const url = linkUrl(link.token);

  // Short, and it names the home. A link arriving from an unknown number
  // three days after a death reads like a scam unless it says who it is.
  const body = `${home.name}: here is your private page for the arrangements. ${url}`;

  let sent = false;
  let smsError: string | null = null;

  try {
    await sendSms({ to: existing.phone, body });
    sent = true;
  } catch (error) {
    if (error instanceof SmsNotSentError) {
      smsError = error.message;
    } else {
      throw error;
    }
  }

  res.json({
    ...toPublicFamilyContact(updated!),
    link: url,
    sent,
    smsError,
  });
});

export default router;

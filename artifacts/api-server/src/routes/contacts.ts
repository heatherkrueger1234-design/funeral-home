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

export default router;

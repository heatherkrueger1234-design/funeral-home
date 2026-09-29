import { RequestFamilyPrintChangesBody } from "@workspace/api-zod";
import { caseMessagesTable, casePrintItemsTable, db } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  badRequest,
  HttpError,
  parseBody,
  parseId,
  requireRow,
} from "../../lib/http";
import { isWithinOfficeHours } from "../../lib/office-hours";
import {
  familyCase,
  familyContact,
  familyHome,
} from "../../middleware/require-family";
import {
  printItemsForCase,
  renderPrintItemHtml,
  sendRenderedHtml,
  toPrintItemJson,
} from "../print";

/** Proofs the family reads and approves. Mounted under /family; see `index.ts`. */
const router: IRouter = Router();

/* --------------------------------------------------------------- print --- */

/**
 * Proofs the home has shared.
 *
 * The single most common reprint is a misspelled name, and the only person
 * who reliably catches that is the family — so a card can be shown to them
 * before two hundred are run off. Only what the home has deliberately
 * shared: a draft a director is still moving around is not something to put
 * in front of a grieving family.
 */
router.get("/print", async (req, res) => {
  const row = familyCase(req);
  const all = await printItemsForCase(
    row,
    row.funeralHomeId,
    familyHome(req).timezone,
  );
  res.json(all.filter((item) => item.sharedWithFamily));
});

/**
 * The actual rendered card behind a proof — what the "Things to check" iframe
 * and its "Open it full size" link point at.
 *
 * Scoped to this case *and* to items the home has explicitly shared: a draft
 * a director is still moving around is not something a guessed id should be
 * able to pull up. This mirrors `GET /print/:printItemId/render` on the staff
 * side, which a family member cannot reach — that route sits behind the
 * cookie session gate, and the portal has no cookie, only this link token.
 */
router.get("/print/:printItemId/render", async (req, res) => {
  const row = familyCase(req);
  const home = familyHome(req);
  const id = parseId(req.params.printItemId);

  const [existing] = await db
    .select()
    .from(casePrintItemsTable)
    .where(
      and(
        eq(casePrintItemsTable.id, id),
        eq(casePrintItemsTable.caseId, row.id),
        eq(casePrintItemsTable.sharedWithFamily, true),
      ),
    )
    .limit(1);

  const item = requireRow(existing, "That could not be found.");

  sendRenderedHtml(res, await renderPrintItemHtml(item, row, home));
});

/**
 * A proof the family may answer: on this case, shared, and still out for
 * checking. Anything else — a draft, one already signed off, one the home has
 * taken back — gets the same 409, because a stale tab is the usual reason.
 */
async function answerableProof(
  caseId: number,
  printItemId: string | undefined,
) {
  const id = parseId(printItemId);
  const [existing] = await db
    .select()
    .from(casePrintItemsTable)
    .where(
      and(
        eq(casePrintItemsTable.id, id),
        eq(casePrintItemsTable.caseId, caseId),
        eq(casePrintItemsTable.sharedWithFamily, true),
      ),
    )
    .limit(1);

  const item = requireRow(existing, "That could not be found.");

  if (item.status !== "proof") {
    throw new HttpError(
      409,
      item.status === "approved"
        ? "This one has already been approved."
        : "The funeral home is working on this one again. They'll send a new proof.",
    );
  }

  return item;
}

/** A line in the thread, written as the family member who acted. */
async function postFamilyLine(
  home: ReturnType<typeof familyHome>,
  caseId: number,
  contactId: number,
  body: string,
) {
  const now = new Date();
  await db.insert(caseMessagesTable).values({
    funeralHomeId: home.id,
    caseId,
    authorContactId: contactId,
    body,
    // Recorded exactly as a typed message would be — see POST /messages.
    sentOutsideOfficeHours: isWithinOfficeHours(home, now) ? null : now,
  });
}

/**
 * Sign a proof off.
 *
 * Only the next of kin: they are who the home takes instructions from, and
 * an approval is an instruction to print two hundred of something. Anybody
 * with a link can still say something is wrong, below — that is the half
 * that matters most, and the cousin is as likely to catch it as anyone.
 */
router.post("/print/:printItemId/approve", async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);
  const home = familyHome(req);

  if (contact.role !== "next_of_kin") {
    throw new HttpError(
      403,
      "Approving is for the family's main contact. If it looks right to you, tell them — or tell the funeral home if something is wrong.",
    );
  }

  const item = await answerableProof(row.id, req.params.printItemId);

  const [updated] = await db
    .update(casePrintItemsTable)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedByUserId: null,
      approvedByContactId: contact.id,
      changesRequestedAt: null,
      changesRequestedNote: null,
      changesRequestedByContactId: null,
      updatedAt: new Date(),
    })
    .where(eq(casePrintItemsTable.id, item.id))
    .returning();

  const name = updated!.title ?? "the card";
  await postFamilyLine(
    home,
    row.id,
    contact.id,
    `I've read "${name}" and it's right. Please go ahead and print it.`,
  );

  res.json(await toPrintItemJson(updated!, row, home.timezone));
});

/**
 * Something on a proof is wrong. Sent back to draft so it leaves "with the
 * family" on the director's list, and the note goes into the thread where
 * it will be seen — the print list shows it too, beside the card.
 */
router.post("/print/:printItemId/changes", async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);
  const home = familyHome(req);
  const { note } = parseBody(RequestFamilyPrintChangesBody, req.body);

  const text = note.trim();
  if (!text) throw badRequest("Say what needs changing.");

  const item = await answerableProof(row.id, req.params.printItemId);

  const [updated] = await db
    .update(casePrintItemsTable)
    .set({
      status: "draft",
      changesRequestedAt: new Date(),
      changesRequestedNote: text,
      changesRequestedByContactId: contact.id,
      updatedAt: new Date(),
    })
    .where(eq(casePrintItemsTable.id, item.id))
    .returning();

  const name = updated!.title ?? "the card";
  await postFamilyLine(
    home,
    row.id,
    contact.id,
    `Something on "${name}" needs changing:\n\n${text}`,
  );

  res.json(await toPrintItemJson(updated!, row, home.timezone));
});

export default router;

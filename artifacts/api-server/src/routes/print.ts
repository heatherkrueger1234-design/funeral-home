import { Router, type IRouter, type Response } from "express";
import { and, asc, desc, eq, inArray, isNull, max } from "drizzle-orm";
import {
  db,
  casePrintItemsTable,
  caseMessagesTable,
  casePhotosTable,
  familyContactsTable,
  usersTable,
  snippetsTable,
  uploadsTable,
  type Case,
  type CasePrintItem,
  type FuneralHome,
  type Snippet,
} from "@workspace/db";
import { decryptBuffer } from "@workspace/db/crypto";
import {
  CreateSnippetBody,
  UpdateSnippetBody,
  CreatePrintItemBody,
  UpdatePrintItemBody,
  GetSnippetsQueryParams,
} from "@workspace/api-zod";
import {
  HttpError,
  assertHasUpdates,
  badRequest,
  parseBody,
  parseId,
  parseQuery,
  requireRow,
} from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import { PRINT_TEMPLATES, findTemplate } from "../lib/print-templates";
import { renderPrintItem, resolveSlots } from "../lib/print-render";
import { loadCase } from "./cases";
import {
  cropInstructionsOf,
  uprightWithCrop,
  type CropInstructions,
} from "../lib/images";

const router: IRouter = Router();

router.get("/print/templates", (_req, res) => {
  // Static, so every home sees the same trade sizes. A home wanting a size
  // that is not here needs a new template, not a text box for inches.
  res.json(
    PRINT_TEMPLATES.map((template) => ({
      ...template,
      slots: template.slots.map((slot) => ({
        key: slot.key,
        label: slot.label,
        kind: slot.kind,
        hint: slot.hint ?? null,
        from: slot.from ?? null,
        maxLength: slot.maxLength ?? null,
      })),
    })),
  );
});

/* ------------------------------------------------------------- snippets -- */

function toSnippetJson(row: Snippet) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    attribution: row.attribution,
    clearedForPrint: row.clearedForPrint,
    position: row.position,
  };
}

router.get("/snippets", async (req, res) => {
  const home = tenant(req);
  const query = parseQuery(GetSnippetsQueryParams, req.query);

  const rows = await db
    .select()
    .from(snippetsTable)
    .where(
      and(
        eq(snippetsTable.funeralHomeId, home.id),
        isNull(snippetsTable.archivedAt),
        query.kind ? eq(snippetsTable.kind, query.kind) : undefined,
      ),
    )
    .orderBy(asc(snippetsTable.position), asc(snippetsTable.title));

  res.json(rows.map(toSnippetJson));
});

router.post("/snippets", async (req, res) => {
  const home = tenant(req);
  const values = parseBody(CreateSnippetBody, req.body);

  const title = values.title.trim();
  const body = values.body.trim();
  if (!title || !body)
    throw badRequest("A snippet needs a title and some text.");

  const [last] = await db
    .select({ value: max(snippetsTable.position) })
    .from(snippetsTable)
    .where(eq(snippetsTable.funeralHomeId, home.id));

  const [created] = await db
    .insert(snippetsTable)
    .values({
      funeralHomeId: home.id,
      kind: values.kind ?? "verse",
      title,
      body,
      attribution: values.attribution ?? null,
      clearedForPrint: values.clearedForPrint ?? false,
      position: (last?.value ?? -1) + 1,
    })
    .returning();

  res.status(201).json(toSnippetJson(created!));
});

async function loadSnippet(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
): Promise<Snippet> {
  const home = tenant(req);
  const id = parseId(rawId);

  const [row] = await db
    .select()
    .from(snippetsTable)
    .where(
      and(eq(snippetsTable.id, id), eq(snippetsTable.funeralHomeId, home.id)),
    )
    .limit(1);

  return requireRow(row, "That one could not be found.");
}

router.put("/snippets/:snippetId", async (req, res) => {
  const existing = await loadSnippet(req, req.params.snippetId);
  const values = assertHasUpdates(parseBody(UpdateSnippetBody, req.body));

  const [updated] = await db
    .update(snippetsTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(snippetsTable.id, existing.id))
    .returning();

  res.json(toSnippetJson(updated!));
});

/** Archived, not deleted: a card already printed from it keeps its text. */
router.delete("/snippets/:snippetId", async (req, res) => {
  const existing = await loadSnippet(req, req.params.snippetId);

  await db
    .update(snippetsTable)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(snippetsTable.id, existing.id));

  res.status(204).end();
});

/* ---------------------------------------------------------- print items -- */

/**
 * The photograph behind a print item: its own, else the case portrait --
 * with the crop the family chose for it.
 *
 * The crop travels with the photograph, not with "being the portrait": a
 * director who picks the same photograph for a bookmark by hand gets the
 * same framing the family set, because it is the same face.
 */
async function photoUploadFor(
  item: Pick<CasePrintItem, "photoId">,
  row: Case,
): Promise<{
  photoId: number | null;
  uploadId: number | null;
  crop: CropInstructions | null;
}> {
  const photoId = item.photoId ?? row.portraitPhotoId;
  if (photoId === null) return { photoId: null, uploadId: null, crop: null };

  const [photo] = await db
    .select({
      uploadId: casePhotosTable.uploadId,
      cropX: casePhotosTable.cropX,
      cropY: casePhotosTable.cropY,
      cropWidth: casePhotosTable.cropWidth,
      cropHeight: casePhotosTable.cropHeight,
    })
    .from(casePhotosTable)
    .where(
      and(eq(casePhotosTable.id, photoId), eq(casePhotosTable.caseId, row.id)),
    )
    .limit(1);

  return {
    photoId,
    uploadId: photo?.uploadId ?? null,
    crop: photo ? cropInstructionsOf(photo) : null,
  };
}

/**
 * The names behind a sign-off or a request for changes, so the print list can
 * say "approved by Anne Whitfield" rather than just "approved". At most a
 * handful of rows per case, so two small lookups are cheaper than a join
 * threaded through every query that returns a print item.
 */
async function peopleFor(item: CasePrintItem) {
  const contactIds = [
    item.approvedByContactId,
    item.changesRequestedByContactId,
  ].filter((id): id is number => id != null);

  const [contacts, [user]] = await Promise.all([
    contactIds.length
      ? db
          .select({ id: familyContactsTable.id, name: familyContactsTable.name })
          .from(familyContactsTable)
          .where(inArray(familyContactsTable.id, contactIds))
      : Promise.resolve([] as { id: number; name: string }[]),
    item.approvedByUserId != null
      ? db
          .select({ name: usersTable.displayName })
          .from(usersTable)
          .where(eq(usersTable.id, item.approvedByUserId))
          .limit(1)
      : Promise.resolve([undefined]),
  ]);

  const nameOf = (id: number | null) =>
    contacts.find((contact) => contact.id === id)?.name ?? null;

  return {
    approvedByName:
      item.approvedByContactId != null
        ? nameOf(item.approvedByContactId)
        : (user?.name ?? null),
    changesRequestedBy: nameOf(item.changesRequestedByContactId),
  };
}

export async function toPrintItemJson(
  item: CasePrintItem,
  row: Case,
  timeZone: string,
) {
  const template = findTemplate(item.templateKey);
  const [{ photoId, uploadId }, people] = await Promise.all([
    photoUploadFor(item, row),
    peopleFor(item),
  ]);
  const values = (item.values ?? {}) as Record<string, string>;

  return {
    id: item.id,
    caseId: item.caseId,
    templateKey: item.templateKey,
    templateName: template?.name ?? item.templateKey,
    title: item.title,
    photoId,
    photoUploadId: uploadId,
    values,
    // What the card will actually say, with the case's own details filled
    // in — so the preview needs no second round trip.
    resolved: template
      ? resolveSlots({ template, case: row, values, timeZone })
      : values,
    quantity: item.quantity,
    status: item.status,
    sharedWithFamily: item.sharedWithFamily,
    approvedAt: item.approvedAt,
    approvedByName: item.status === "approved" ? people.approvedByName : null,
    approvedByFamily:
      item.status === "approved" && item.approvedByContactId != null,
    changesRequestedAt: item.changesRequestedAt,
    changesRequestedNote: item.changesRequestedNote,
    changesRequestedBy: people.changesRequestedBy,
    updatedAt: item.updatedAt,
  };
}

export async function printItemsForCase(
  row: Case,
  funeralHomeId: number,
  timeZone: string,
) {
  const rows = await db
    .select()
    .from(casePrintItemsTable)
    .where(
      and(
        eq(casePrintItemsTable.caseId, row.id),
        eq(casePrintItemsTable.funeralHomeId, funeralHomeId),
      ),
    )
    .orderBy(desc(casePrintItemsTable.updatedAt));

  return Promise.all(
    rows.map((item) => toPrintItemJson(item, row, timeZone)),
  );
}

router.get("/cases/:caseId/print", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  res.json(await printItemsForCase(row, home.id, home.timezone));
});

router.post("/cases/:caseId/print", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const values = parseBody(CreatePrintItemBody, req.body);

  const template = findTemplate(values.templateKey);
  if (!template) throw badRequest("That is not one of the templates.");

  const [created] = await db
    .insert(casePrintItemsTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      templateKey: template.key,
      title: values.title ?? template.name,
      values: {},
    })
    .returning();

  res.status(201).json(await toPrintItemJson(created!, row, home.timezone));
});

async function loadPrintItem(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
): Promise<CasePrintItem> {
  const home = tenant(req);
  const id = parseId(rawId);

  const [row] = await db
    .select()
    .from(casePrintItemsTable)
    .where(
      and(
        eq(casePrintItemsTable.id, id),
        eq(casePrintItemsTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  return requireRow(row, "That could not be found.");
}

async function caseFor(caseId: number): Promise<Case> {
  const { casesTable } = await import("@workspace/db");
  const [row] = await db
    .select()
    .from(casesTable)
    .where(eq(casesTable.id, caseId))
    .limit(1);
  return row!;
}

router.put("/print/:printItemId", async (req, res) => {
  const user = currentUser(req);
  const existing = await loadPrintItem(req, req.params.printItemId);
  const patch = assertHasUpdates(parseBody(UpdatePrintItemBody, req.body));

  const template = findTemplate(existing.templateKey);

  /*
   * An approved card is the one the family signed off. Changing its words or
   * its photograph afterwards would print something nobody checked, so the
   * wording is frozen until it is reopened — in the same request is fine,
   * which is what the studio's "Approved — reopen" does. The number of copies
   * is not something a family proofreads, so that stays editable.
   */
  const reopening = patch.status != null && patch.status !== "approved";
  if (
    existing.status === "approved" &&
    !reopening &&
    (patch.values !== undefined ||
      patch.photoId !== undefined ||
      patch.title !== undefined)
  ) {
    throw new HttpError(
      409,
      "This one has been approved. Reopen it before changing what it says.",
    );
  }

  /*
   * Slot values are merged rather than replaced, and unknown keys dropped.
   * Merged because the studio saves one field at a time as a director types;
   * filtered because `values` is JSON and an unchecked write there is the one
   * place arbitrary keys could accumulate.
   */
  let nextValues: Record<string, string> | undefined;

  if (patch.values) {
    const allowed = new Set(template?.slots.map((slot) => slot.key) ?? []);
    const current = (existing.values ?? {}) as Record<string, string>;
    nextValues = { ...current };

    for (const [key, value] of Object.entries(patch.values)) {
      if (!allowed.has(key)) continue;

      const slot = template?.slots.find((entry) => entry.key === key);
      const text = String(value ?? "");

      if (slot?.maxLength && text.length > slot.maxLength) {
        throw badRequest(
          `"${slot.label}" is longer than fits on a ${template?.name ?? "card"}.`,
        );
      }

      nextValues[key] = text;
    }
  }

  // A photograph has to be one on this case.
  if (patch.photoId != null) {
    const [photo] = await db
      .select({ id: casePhotosTable.id })
      .from(casePhotosTable)
      .where(
        and(
          eq(casePhotosTable.id, patch.photoId),
          eq(casePhotosTable.caseId, existing.caseId),
        ),
      )
      .limit(1);

    if (!photo) throw badRequest("That photograph is not on this case.");
  }

  const approving =
    patch.status === "approved" && existing.status !== "approved";

  const [updated] = await db
    .update(casePrintItemsTable)
    .set({
      ...patch,
      ...(nextValues ? { values: nextValues } : {}),
      ...(approving
        ? {
            approvedAt: new Date(),
            approvedByUserId: user.id,
            approvedByContactId: null,
          }
        : patch.status && patch.status !== "approved"
          ? { approvedAt: null, approvedByUserId: null, approvedByContactId: null }
          : {}),
      // Sending a fresh proof, or signing it off, answers whatever the family
      // asked for last time; leaving the old note up would read as unhandled.
      ...(patch.status === "proof" || approving
        ? {
            changesRequestedAt: null,
            changesRequestedNote: null,
            changesRequestedByContactId: null,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(casePrintItemsTable.id, existing.id))
    .returning();

  /*
   * The moment a proof becomes something the family can act on — shared and
   * waiting on them — say so in the thread. Without this the family only
   * finds it if they happen to open "Things to check", and the director
   * waits on an answer nobody knows they owe.
   */
  const wasWaiting = existing.sharedWithFamily && existing.status === "proof";
  const nowWaiting = updated!.sharedWithFamily && updated!.status === "proof";
  if (nowWaiting && !wasWaiting) {
    const name = updated!.title ?? template?.name ?? "card";
    await db.insert(caseMessagesTable).values({
      funeralHomeId: existing.funeralHomeId,
      caseId: existing.caseId,
      authorUserId: user.id,
      body: `A proof of "${name}" is ready for you to read before it's printed. You'll find it under "Things to check" — please look closely at the spellings, and approve it or tell us what needs changing.`,
    });
  }

  res.json(
    await toPrintItemJson(
      updated!,
      await caseFor(existing.caseId),
      tenant(req).timezone,
    ),
  );
});

router.delete("/print/:printItemId", async (req, res) => {
  const existing = await loadPrintItem(req, req.params.printItemId);

  await db
    .delete(casePrintItemsTable)
    .where(eq(casePrintItemsTable.id, existing.id));

  res.status(204).end();
});

/**
 * Bytes as a data URI, so the rendered page is one self-contained file.
 *
 * Scoped to the home, like every other read of `uploads`. This used to look
 * the id up on its own, and `home.logoUploadId` is a number a home writes
 * itself through `PUT /home` -- so pointing it at another home's upload id
 * and rendering any prayer card inlined that home's decrypted file (a
 * family's photograph, or anything else stored there) into this one's page.
 * `PUT /home` now refuses a foreign id as well; this is the half that also
 * covers a row written before it did.
 */
async function dataUri(
  uploadId: number | null,
  funeralHomeId: number,
  crop: CropInstructions | null = null,
): Promise<string | null> {
  if (uploadId === null) return null;

  const [upload] = await db
    .select()
    .from(uploadsTable)
    .where(
      and(
        eq(uploadsTable.id, uploadId),
        eq(uploadsTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  if (!upload) return null;

  try {
    const bytes = decryptBuffer(upload.data);
    if (!crop) {
      return `data:${upload.mimeType};base64,${bytes.toString("base64")}`;
    }

    /*
     * Cut to the family's framing for this page only. The card's frame then
     * covers the cut the way the portal's frame covers it (`object-fit:
     * cover`, centred), so a 4:5 prayer card shows exactly what the family
     * framed and the square register page loses a sliver top and bottom --
     * the same answer `visibleRect` gives on both screens. The original is
     * still what is stored and what the photo pack exports.
     */
    const cut = await (await uprightWithCrop(bytes, crop))
      .jpeg({ quality: 90 })
      .toBuffer();
    return `data:image/jpeg;base64,${cut.toString("base64")}`;
  } catch {
    // A card with a missing picture still prints; a 500 helps nobody at
    // nine at night before an eleven o'clock service.
    return null;
  }
}

/** Shared by the staff and family render endpoints: one card, one renderer. */
export async function renderPrintItemHtml(
  item: CasePrintItem,
  row: Case,
  home: FuneralHome,
): Promise<string> {
  const template = findTemplate(item.templateKey);
  if (!template) throw badRequest("That template no longer exists.");

  const { uploadId, crop } = await photoUploadFor(item, row);

  return renderPrintItem({
    template,
    case: row,
    home,
    values: (item.values ?? {}) as Record<string, string>,
    photoDataUri: await dataUri(uploadId, home.id, crop),
    logoDataUri: await dataUri(home.logoUploadId, home.id),
  });
}

function sendRenderedHtml(res: Response, html: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Self-contained and specific to one case: never cached by a shared proxy.
  res.setHeader("Cache-Control", "private, no-store");
  // The one route on this process that serves real HTML (see app.ts, which
  // disables CSP everywhere else). Every value in it is escaped before it
  // gets here, so this is defense-in-depth against the day a future field is
  // added to the template without going through that escaping.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  );
  res.send(html);
}

router.get("/print/:printItemId/render", async (req, res) => {
  const home = tenant(req);
  const existing = await loadPrintItem(req, req.params.printItemId);
  const row = await caseFor(existing.caseId);

  sendRenderedHtml(res, await renderPrintItemHtml(existing, row, home));
});

export { sendRenderedHtml };
export default router;

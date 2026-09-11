import { Router, type IRouter } from "express";
import { and, asc, desc, eq, isNull, max } from "drizzle-orm";
import {
  db,
  casePrintItemsTable,
  casePhotosTable,
  snippetsTable,
  uploadsTable,
  type Case,
  type CasePrintItem,
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
  if (!title || !body) throw badRequest("A snippet needs a title and some text.");

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

/** The photograph behind a print item: its own, else the case portrait. */
async function photoUploadFor(
  item: Pick<CasePrintItem, "photoId">,
  row: Case,
): Promise<{ photoId: number | null; uploadId: number | null }> {
  const photoId = item.photoId ?? row.portraitPhotoId;
  if (photoId === null) return { photoId: null, uploadId: null };

  const [photo] = await db
    .select({ uploadId: casePhotosTable.uploadId })
    .from(casePhotosTable)
    .where(
      and(eq(casePhotosTable.id, photoId), eq(casePhotosTable.caseId, row.id)),
    )
    .limit(1);

  return { photoId, uploadId: photo?.uploadId ?? null };
}

async function toPrintItemJson(item: CasePrintItem, row: Case) {
  const template = findTemplate(item.templateKey);
  const { photoId, uploadId } = await photoUploadFor(item, row);
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
      ? resolveSlots({ template, case: row, values })
      : values,
    quantity: item.quantity,
    status: item.status,
    sharedWithFamily: item.sharedWithFamily,
    approvedAt: item.approvedAt,
    updatedAt: item.updatedAt,
  };
}

export async function printItemsForCase(row: Case, funeralHomeId: number) {
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

  return Promise.all(rows.map((item) => toPrintItemJson(item, row)));
}

router.get("/cases/:caseId/print", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  res.json(await printItemsForCase(row, home.id));
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

  res.status(201).json(await toPrintItemJson(created!, row));
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

  const approving = patch.status === "approved" && existing.status !== "approved";

  const [updated] = await db
    .update(casePrintItemsTable)
    .set({
      ...patch,
      ...(nextValues ? { values: nextValues } : {}),
      ...(approving
        ? { approvedAt: new Date(), approvedByUserId: user.id }
        : patch.status && patch.status !== "approved"
          ? { approvedAt: null, approvedByUserId: null }
          : {}),
      updatedAt: new Date(),
    })
    .where(eq(casePrintItemsTable.id, existing.id))
    .returning();

  res.json(await toPrintItemJson(updated!, await caseFor(existing.caseId)));
});

router.delete("/print/:printItemId", async (req, res) => {
  const existing = await loadPrintItem(req, req.params.printItemId);

  await db
    .delete(casePrintItemsTable)
    .where(eq(casePrintItemsTable.id, existing.id));

  res.status(204).end();
});

/** Bytes as a data URI, so the rendered page is one self-contained file. */
async function dataUri(uploadId: number | null): Promise<string | null> {
  if (uploadId === null) return null;

  const [upload] = await db
    .select()
    .from(uploadsTable)
    .where(eq(uploadsTable.id, uploadId))
    .limit(1);

  if (!upload) return null;

  try {
    const bytes = decryptBuffer(upload.data);
    return `data:${upload.mimeType};base64,${bytes.toString("base64")}`;
  } catch {
    // A card with a missing picture still prints; a 500 helps nobody at
    // nine at night before an eleven o'clock service.
    return null;
  }
}

router.get("/print/:printItemId/render", async (req, res) => {
  const home = tenant(req);
  const existing = await loadPrintItem(req, req.params.printItemId);
  const row = await caseFor(existing.caseId);

  const template = findTemplate(existing.templateKey);
  if (!template) throw badRequest("That template no longer exists.");

  const { uploadId } = await photoUploadFor(existing, row);

  const html = renderPrintItem({
    template,
    case: row,
    home,
    values: (existing.values ?? {}) as Record<string, string>,
    photoDataUri: await dataUri(uploadId),
    logoDataUri: await dataUri(home.logoUploadId),
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Self-contained and specific to one case: never cached by a shared proxy.
  res.setHeader("Cache-Control", "private, no-store");
  res.send(html);
});

export default router;

import { GetFamilyUploadQueryParams } from "@workspace/api-zod";
import { db, lifeChaptersTable, memoryEntriesTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  assertHasUpdates,
  HttpError,
  parseBody,
  parseId,
  parseQuery,
  requireRow,
} from "../../lib/http";
import { serveUpload } from "../../lib/media";
import {
  familyCase,
  familyContact,
  familyHome,
} from "../../middleware/require-family";
import {
  assertPhotoBelongs,
  assertSaneYears,
  bookIsOpen,
  lifeChapterInputSchema,
  lifeChapterUpdateSchema,
  loadOrCreateBook,
  memoryEntryInputSchema,
  memoryEntryUpdateSchema,
  nextChapterPosition,
  nextMemoryPosition,
  renderBookFor,
  toBookJson,
  toChapterJson,
} from "../memory-book";
import { sendRenderedHtml } from "../print";

/** The memory book, and the family's own uploads. Mounted under /family; see `index.ts`. */
const router: IRouter = Router();

/* --------------------------------------------------------- memory book --- */

/**
 * The family's side of the memory book, and the reason the feature exists.
 *
 * The grief check-ins arrive at thirty, sixty and ninety days and on the
 * anniversary, and each one now asks whether anything has come back to
 * them. This is where the answer goes. By the year mark there is a book
 * with the photographs already in it, because the photographs have been in
 * here since the funeral.
 *
 * Everything below is free, and stays free after the home has cancelled.
 * The book is assembled out of pictures this family uploaded of their own
 * mother and words they wrote themselves; `schema/plans.ts` sets out why
 * charging them for it is the one revenue line this product refuses, and
 * `no-family-charges.test.ts` fails the build if it ever grows one.
 */

router.get("/memory-book", async (req, res) => {
  const row = familyCase(req);
  const contact = familyContact(req);
  const book = await loadOrCreateBook(row.id, row.funeralHomeId);

  const entries = await db
    .select()
    .from(memoryEntriesTable)
    .where(
      and(
        eq(memoryEntriesTable.caseId, row.id),
        eq(memoryEntriesTable.funeralHomeId, row.funeralHomeId),
      ),
    )
    .orderBy(asc(memoryEntriesTable.position), asc(memoryEntriesTable.id));

  /*
   * A family member sees what is in the book, plus their own entries even
   * if the home has taken one out.
   *
   * Their own is deliberate. Somebody who writes a memory and then cannot
   * find it concludes the software lost it and writes it again; showing it
   * to them, marked, is the honest version. What they are not shown is
   * `excludedReason`, which is a note between the home and itself.
   */
  const visible = entries.filter(
    (entry) => entry.includedInBook || entry.authorContactId === contact.id,
  );

  const chapters = await db
    .select()
    .from(lifeChaptersTable)
    .where(
      and(
        eq(lifeChaptersTable.caseId, row.id),
        eq(lifeChaptersTable.funeralHomeId, row.funeralHomeId),
      ),
    )
    .orderBy(asc(lifeChaptersTable.startYear), asc(lifeChaptersTable.position));

  res.json({
    ...toBookJson(book),
    chapters: chapters
      .filter(
        (chapter) =>
          chapter.includedInBook || chapter.authorContactId === contact.id,
      )
      .map((chapter) => ({
        ...toChapterJson(chapter),
        mine: chapter.authorContactId === contact.id,
      })),
    entries: visible.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      authorName: entry.authorName,
      body: entry.body,
      whenText: entry.whenText,
      photoId: entry.photoId,
      includedInBook: entry.includedInBook,
      /** Whether this one is theirs to edit. */
      mine: entry.authorContactId === contact.id,
      createdAt: entry.createdAt,
    })),
  });
});

/**
 * Add a memory.
 *
 * `authorName` is not taken from the request. It is the contact's own name
 * as the home recorded it, snapshotted at this moment — so nobody can sign
 * somebody else's name to a paragraph in a family's keepsake, and a later
 * correction to the contact record cannot rewrite what was printed.
 */
router.post("/memory-book/entries", async (req, res) => {
  const row = familyCase(req);
  const contact = familyContact(req);
  const book = await loadOrCreateBook(row.id, row.funeralHomeId);

  if (!bookIsOpen(book)) {
    throw new HttpError(
      409,
      "This book has been closed for printing. Tell the funeral home if there is something you would still like to add.",
    );
  }

  const values = parseBody(memoryEntryInputSchema, req.body);
  await assertPhotoBelongs(values.photoId, row.id, row.funeralHomeId);

  const [created] = await db.transaction(async (tx) =>
    tx
      .insert(memoryEntriesTable)
      .values({
        funeralHomeId: row.funeralHomeId,
        caseId: row.id,
        authorName: contact.name,
        authorSide: "family",
        authorContactId: contact.id,
        // A relative who read at the service can send what they read; it
        // prints with the day rather than with the memories.
        kind: values.kind ?? "memory",
        body: values.body,
        whenText: values.whenText ?? null,
        photoId: values.photoId ?? null,
        position: await nextMemoryPosition(tx, row.id),
      })
      .returning(),
  );

  res.status(201).json({
    id: created!.id,
    kind: created!.kind,
    authorName: created!.authorName,
    body: created!.body,
    whenText: created!.whenText,
    photoId: created!.photoId,
    includedInBook: created!.includedInBook,
    mine: true,
    createdAt: created!.createdAt,
  });
});

/** Their own entry, and only their own. */
async function loadOwnEntry(
  entryId: number,
  caseId: number,
  contactId: number,
) {
  const [entry] = await db
    .select()
    .from(memoryEntriesTable)
    .where(
      and(
        eq(memoryEntriesTable.id, entryId),
        eq(memoryEntriesTable.caseId, caseId),
        // Not "and then check who wrote it" — the predicate is the check.
        // A relative editing another relative's memory of their mother is
        // not a thing this should be one forgotten `if` away from.
        eq(memoryEntriesTable.authorContactId, contactId),
      ),
    )
    .limit(1);

  return requireRow(entry, "That memory could not be found.");
}

router.put("/memory-book/entries/:entryId", async (req, res) => {
  const row = familyCase(req);
  const contact = familyContact(req);
  const book = await loadOrCreateBook(row.id, row.funeralHomeId);

  const entry = await loadOwnEntry(
    parseId(req.params.entryId),
    row.id,
    contact.id,
  );

  if (!bookIsOpen(book)) {
    throw new HttpError(
      409,
      "This book has been closed for printing, so it can no longer be changed here.",
    );
  }

  const values = assertHasUpdates(parseBody(memoryEntryUpdateSchema, req.body));
  await assertPhotoBelongs(values.photoId, row.id, row.funeralHomeId);

  const [updated] = await db
    .update(memoryEntriesTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(memoryEntriesTable.id, entry.id))
    .returning();

  res.json({
    id: updated!.id,
    kind: updated!.kind,
    authorName: updated!.authorName,
    body: updated!.body,
    whenText: updated!.whenText,
    photoId: updated!.photoId,
    includedInBook: updated!.includedInBook,
    mine: true,
    createdAt: updated!.createdAt,
  });
});

/**
 * Take their own memory back out.
 *
 * A real delete, unlike the home's exclude. Somebody who wrote something at
 * two in the morning six weeks after their mother died and wants it gone is
 * entitled to have it gone, not flagged.
 */
router.delete("/memory-book/entries/:entryId", async (req, res) => {
  const row = familyCase(req);
  const contact = familyContact(req);
  const book = await loadOrCreateBook(row.id, row.funeralHomeId);

  const entry = await loadOwnEntry(
    parseId(req.params.entryId),
    row.id,
    contact.id,
  );

  // Closed for printing means closed: a stale tab's "remove" must not take
  // a page out of a book that has gone to the printer.
  if (!bookIsOpen(book)) {
    throw new HttpError(
      409,
      "This book has been closed for printing, so it can no longer be changed here.",
    );
  }

  await db
    .delete(memoryEntriesTable)
    .where(eq(memoryEntriesTable.id, entry.id));

  res.status(204).end();
});

/**
 * Their copy of the book.
 *
 * Byte for byte the same document the funeral home prints — one renderer,
 * no watermark, no preview edition, and no page missing. That is enforced
 * by there being one function rather than by anybody remembering.
 */
router.get("/memory-book/render", async (req, res) => {
  const row = familyCase(req);
  const home = familyHome(req);

  // Through the same sender as every other rendered page, so it carries the
  // locked-down CSP: this HTML is built from what relatives typed, and the
  // app-wide helmet config turns CSP off for this process (see app.ts).
  sendRenderedHtml(res, await renderBookFor({ case: row, home }));
});

/**
 * The family writing their own life story, a chapter at a time.
 *
 * This is the part the aftercare year is for. Nobody sits down the week
 * after their mother dies and writes where she was born; over nine months,
 * prompted four times, a family between them will write most of it.
 *
 * A chapter is not signed in the book — see the schema — so unlike a memory
 * there is no attribution to get right here. The author is recorded all the
 * same, because a director asked "who wrote this, it is wrong" needs an
 * answer.
 */

router.post("/memory-book/chapters", async (req, res) => {
  const row = familyCase(req);
  const contact = familyContact(req);
  const book = await loadOrCreateBook(row.id, row.funeralHomeId);

  if (!bookIsOpen(book)) {
    throw new HttpError(
      409,
      "This book has been closed for printing. Tell the funeral home if there is something you would still like to add.",
    );
  }

  const values = parseBody(lifeChapterInputSchema, req.body);
  assertSaneYears(values);
  await assertPhotoBelongs(values.photoId, row.id, row.funeralHomeId);

  const [created] = await db.transaction(async (tx) =>
    tx
      .insert(lifeChaptersTable)
      .values({
        funeralHomeId: row.funeralHomeId,
        caseId: row.id,
        title: values.title ?? null,
        body: values.body ?? null,
        startYear: values.startYear ?? null,
        endYear: values.endYear ?? null,
        photoId: values.photoId ?? null,
        authorName: contact.name,
        authorSide: "family",
        authorContactId: contact.id,
        position: await nextChapterPosition(tx, row.id),
      })
      .returning(),
  );

  res.status(201).json({ ...toChapterJson(created!), mine: true });
});

/**
 * Their own chapter, and only their own.
 *
 * A softer rule than it looks: a life story is collectively written, so two
 * relatives will inevitably want to correct each other's dates. They can —
 * by adding a chapter, or by telling the home, which can edit anything.
 * What is not allowed is one relative silently overwriting another's
 * account of their mother's life, which is a different thing entirely.
 */
async function loadOwnChapter(
  chapterId: number,
  caseId: number,
  contactId: number,
) {
  const [chapter] = await db
    .select()
    .from(lifeChaptersTable)
    .where(
      and(
        eq(lifeChaptersTable.id, chapterId),
        eq(lifeChaptersTable.caseId, caseId),
        eq(lifeChaptersTable.authorContactId, contactId),
      ),
    )
    .limit(1);

  return requireRow(chapter, "That chapter could not be found.");
}

router.put("/memory-book/chapters/:chapterId", async (req, res) => {
  const row = familyCase(req);
  const contact = familyContact(req);
  const book = await loadOrCreateBook(row.id, row.funeralHomeId);

  const chapter = await loadOwnChapter(
    parseId(req.params.chapterId),
    row.id,
    contact.id,
  );

  if (!bookIsOpen(book)) {
    throw new HttpError(
      409,
      "This book has been closed for printing, so it can no longer be changed here.",
    );
  }

  const values = assertHasUpdates(parseBody(lifeChapterUpdateSchema, req.body));
  assertSaneYears({
    startYear: values.startYear ?? chapter.startYear,
    endYear: values.endYear ?? chapter.endYear,
  });
  await assertPhotoBelongs(values.photoId, row.id, row.funeralHomeId);

  const [updated] = await db
    .update(lifeChaptersTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(lifeChaptersTable.id, chapter.id))
    .returning();

  res.json({ ...toChapterJson(updated!), mine: true });
});

/**
 * Take their own chapter back out. Deliberately allowed after the book closes,
 * for the same reason as a memory above: what they wrote is theirs to withdraw.
 */
router.delete("/memory-book/chapters/:chapterId", async (req, res) => {
  const row = familyCase(req);
  const contact = familyContact(req);
  const book = await loadOrCreateBook(row.id, row.funeralHomeId);

  const chapter = await loadOwnChapter(
    parseId(req.params.chapterId),
    row.id,
    contact.id,
  );

  // Closed for printing means closed: a stale tab's "remove" must not take
  // a page out of a book that has gone to the printer.
  if (!bookIsOpen(book)) {
    throw new HttpError(
      409,
      "This book has been closed for printing, so it can no longer be changed here.",
    );
  }

  await db
    .delete(lifeChaptersTable)
    .where(eq(lifeChaptersTable.id, chapter.id));

  res.status(204).end();
});

/* ------------------------------------------------------------- uploads --- */

router.get("/uploads/:uploadId", async (req, res) => {
  const row = familyCase(req);
  const home = familyHome(req);
  const { size } = parseQuery(GetFamilyUploadQueryParams, req.query);

  // Scoped to this case, plus the home's logo and nothing else. However the
  // id is mangled, no other family's file is reachable -- nor its thumbnail,
  // which is only ever served on the photograph's say-so.
  await serveUpload(res, {
    uploadId: parseId(req.params.uploadId),
    funeralHomeId: home.id,
    caseId: row.id,
    logoUploadId: home.logoUploadId,
    size,
  });
});

export default router;

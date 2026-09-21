import { Router, type IRouter } from "express";
import { and, asc, count, eq, max } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  casePhotosTable,
  memoryBooksTable,
  memoryEntriesTable,
  MEMORY_MAX_LENGTH,
  MEMORY_BOOK_MAX_PHOTOS,
  type Case,
  type FuneralHome,
  type MemoryBook,
  type MemoryEntry,
} from "@workspace/db";
import {
  assertHasUpdates,
  badRequest,
  parseBody,
  parseId,
  requireRow,
} from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import {
  contactNamesFor,
  loadBookContents,
  renderMemoryBook,
} from "../lib/memory-book";
import { loadCase } from "./cases";

/**
 * The director's side of the memory book.
 *
 * Most of what a home does here is nothing: the family fills it in, and the
 * book prints. What this router adds is the handful of things only the home
 * can do — type up the card that arrived in the post, take out the entry
 * that should not be in a widow's keepsake, put the pages in an order, and
 * close the book on the day it goes to the printer.
 */

const router: IRouter = Router();

/*
 * Request shapes live here rather than in the db package, alongside the
 * other routers that do the same. `parseBody` is typed against the classic
 * zod entry and the schema files use `zod/v4`, which is a different type
 * identity -- and validating a request next to the handler that serves it
 * is the better arrangement regardless.
 */

/**
 * What anybody writing a memory may send.
 *
 * `whenText` is free text, not a date, and `memories.ts` explains at length
 * why: a memory's date is "the summer we had the caravan", and a date
 * picker here makes people give up rather than answer.
 */
export const memoryEntryInputSchema = z.object({
  body: z.string().trim().min(1).max(MEMORY_MAX_LENGTH),
  whenText: z.string().trim().max(120).nullable().optional(),
  photoId: z.number().int().positive().nullable().optional(),
});

const BookSettingsBody = z.object({
  title: z.string().trim().max(160).nullable().optional(),
  dedication: z.string().trim().max(1000).nullable().optional(),
  includePhotos: z.boolean().optional(),
  includeObituary: z.boolean().optional(),
  /** An ISO date-time, or null to reopen the book. */
  closesAt: z.string().datetime().nullable().optional(),
});

/**
 * Find the book for a case, making it if this is the first look.
 *
 * Created lazily rather than with every case, so that the table says which
 * cases anybody is actually keeping a book for. Exported because the family
 * surface needs exactly the same behaviour: a family who follows a link
 * from a check-in must not find nothing there because no member of staff
 * has happened to open the page yet.
 */
export async function loadOrCreateBook(
  caseId: number,
  funeralHomeId: number,
): Promise<MemoryBook> {
  const [existing] = await db
    .select()
    .from(memoryBooksTable)
    .where(
      and(
        eq(memoryBooksTable.caseId, caseId),
        eq(memoryBooksTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(memoryBooksTable)
    .values({ caseId, funeralHomeId })
    // Two people opening the page at once must not produce two books.
    .onConflictDoNothing({ target: memoryBooksTable.caseId })
    .returning();

  if (created) return created;

  const [raced] = await db
    .select()
    .from(memoryBooksTable)
    .where(eq(memoryBooksTable.caseId, caseId))
    .limit(1);

  return requireRow(raced, "That book could not be opened.");
}

/** Whether the book is still taking entries. */
export function bookIsOpen(book: MemoryBook, now = new Date()): boolean {
  return book.closesAt === null || book.closesAt > now;
}

export function toBookJson(book: MemoryBook, now = new Date()) {
  return {
    id: book.id,
    caseId: book.caseId,
    title: book.title,
    dedication: book.dedication,
    closesAt: book.closesAt,
    open: bookIsOpen(book, now),
    includePhotos: book.includePhotos,
    includeObituary: book.includeObituary,
  };
}

export function toEntryJson(entry: MemoryEntry) {
  return {
    id: entry.id,
    authorName: entry.authorName,
    authorSide: entry.authorSide,
    authorContactId: entry.authorContactId,
    body: entry.body,
    whenText: entry.whenText,
    photoId: entry.photoId,
    includedInBook: entry.includedInBook,
    excludedReason: entry.excludedReason,
    position: entry.position,
    createdAt: entry.createdAt,
  };
}

/**
 * A photograph referenced by a memory must belong to this case.
 *
 * Checked rather than assumed, because `photoId` is a number from a request
 * body and the whole tenancy model rests on never trusting one. Without
 * this, a contact on one case could name a photograph id from another home's
 * case and have it rendered into a book.
 */
export async function assertPhotoBelongs(
  photoId: number | null | undefined,
  caseId: number,
  funeralHomeId: number,
): Promise<void> {
  if (photoId === null || photoId === undefined) return;

  const [photo] = await db
    .select({ id: casePhotosTable.id })
    .from(casePhotosTable)
    .where(
      and(
        eq(casePhotosTable.id, photoId),
        eq(casePhotosTable.caseId, caseId),
        eq(casePhotosTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  if (!photo) {
    throw badRequest("That photograph is not on this case.");
  }
}

/** Next position, so a new entry lands at the end rather than at the top. */
export async function nextMemoryPosition(caseId: number): Promise<number> {
  const [row] = await db
    .select({ highest: max(memoryEntriesTable.position) })
    .from(memoryEntriesTable)
    .where(eq(memoryEntriesTable.caseId, caseId));

  return (row?.highest ?? 0) + 1;
}

/* --------------------------------------------------------- the routes -- */

router.get("/cases/:caseId/memory-book", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const book = await loadOrCreateBook(row.id, home.id);

  const entries = await db
    .select()
    .from(memoryEntriesTable)
    .where(
      and(
        eq(memoryEntriesTable.caseId, row.id),
        eq(memoryEntriesTable.funeralHomeId, home.id),
      ),
    )
    .orderBy(asc(memoryEntriesTable.position), asc(memoryEntriesTable.id));

  const contactNames = await contactNamesFor(row.id);

  /*
   * How many photographs would go in, against the ceiling.
   *
   * Counted rather than rendered, because rendering decrypts and re-encodes
   * every picture and this is a page a director opens to read the entries.
   * It is here so that a home with two hundred selected photographs finds
   * out from the page rather than from a family asking why Aunt Susan is
   * not in the book.
   */
  const [photoCount] = await db
    .select({ total: count() })
    .from(casePhotosTable)
    .where(
      and(
        eq(casePhotosTable.caseId, row.id),
        eq(casePhotosTable.funeralHomeId, home.id),
        eq(casePhotosTable.status, "visible"),
        eq(casePhotosTable.selected, true),
      ),
    );

  res.json({
    ...toBookJson(book),
    photos: {
      selected: photoCount?.total ?? 0,
      limit: MEMORY_BOOK_MAX_PHOTOS,
      note:
        "Photographs beyond the limit, or beyond the file-size ceiling, are " +
        "left out so the book stays a file the family can actually open.",
    },
    // The director sees everything, including what has been taken out. An
    // exclusion nobody can see afterwards is indistinguishable from a bug.
    entries: entries.map((entry) => ({
      ...toEntryJson(entry),
      // The contact's name as it stands now, alongside the snapshot that
      // will be printed, so a director can spot one that reads oddly.
      contactNameNow: entry.authorContactId
        ? (contactNames.get(entry.authorContactId) ?? null)
        : null,
    })),
  });
});

router.put("/cases/:caseId/memory-book", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const book = await loadOrCreateBook(row.id, home.id);

  const { closesAt, ...values } = assertHasUpdates(
    parseBody(BookSettingsBody, req.body),
  );

  const [updated] = await db
    .update(memoryBooksTable)
    .set({
      ...values,
      // Pulled out of the spread rather than overridden after it: the body
      // carries an ISO string and the column wants a Date.
      ...(closesAt === undefined
        ? {}
        : { closesAt: closesAt === null ? null : new Date(closesAt) }),
      updatedAt: new Date(),
    })
    .where(eq(memoryBooksTable.id, book.id))
    .returning();

  res.json(toBookJson(updated!));
});

/**
 * The home adds a memory on somebody's behalf.
 *
 * This is not an afterthought — it is how most of the early entries arrive.
 * People say things at the graveside and write things in cards, and the
 * director is the only person who hears and reads all of it. `authorName`
 * is whose memory it is, not who typed it.
 */
const StaffEntryBody = memoryEntryInputSchema.extend({
  authorName: z.string().trim().min(1).max(120),
});

router.post("/cases/:caseId/memory-book/entries", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  await loadOrCreateBook(row.id, home.id);

  const values = parseBody(StaffEntryBody, req.body);
  await assertPhotoBelongs(values.photoId, row.id, home.id);

  const [created] = await db
    .insert(memoryEntriesTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      authorName: values.authorName,
      authorSide: "staff",
      authorUserId: user.id,
      body: values.body,
      whenText: values.whenText ?? null,
      photoId: values.photoId ?? null,
      position: await nextMemoryPosition(row.id),
    })
    .returning();

  res.status(201).json(toEntryJson(created!));
});

const StaffEntryUpdate = z.object({
  body: z.string().trim().min(1).max(4000).optional(),
  whenText: z.string().trim().max(120).nullable().optional(),
  photoId: z.number().int().positive().nullable().optional(),
  position: z.number().int().min(0).optional(),
  includedInBook: z.boolean().optional(),
  excludedReason: z.string().trim().max(400).nullable().optional(),
});

async function loadEntry(
  entryId: number,
  caseId: number,
  funeralHomeId: number,
): Promise<MemoryEntry> {
  const [entry] = await db
    .select()
    .from(memoryEntriesTable)
    .where(
      and(
        eq(memoryEntriesTable.id, entryId),
        eq(memoryEntriesTable.caseId, caseId),
        eq(memoryEntriesTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  return requireRow(entry, "That memory could not be found.");
}

router.put("/cases/:caseId/memory-book/entries/:entryId", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const entry = await loadEntry(parseId(req.params.entryId), row.id, home.id);

  const values = assertHasUpdates(parseBody(StaffEntryUpdate, req.body));
  await assertPhotoBelongs(values.photoId, row.id, home.id);

  const now = new Date();

  const [updated] = await db
    .update(memoryEntriesTable)
    .set({
      ...values,
      /*
       * Taking an entry out is stamped; putting it back clears the stamp.
       * The row itself is never deleted by this route, because "why is my
       * memory of Mum not in the book" is a question somebody will ask and
       * a director should be able to answer.
       */
      ...(values.includedInBook === undefined
        ? {}
        : values.includedInBook
          ? { excludedAt: null, excludedReason: null }
          : { excludedAt: entry.excludedAt ?? now }),
      updatedAt: now,
    })
    .where(eq(memoryEntriesTable.id, entry.id))
    .returning();

  res.json(toEntryJson(updated!));
});

/**
 * Deleting for real.
 *
 * Kept separate from excluding, and it is the rarer of the two: this is for
 * a duplicate, or something typed into the wrong case. Taking a relative's
 * words out of the book is `includedInBook: false`, which leaves a record.
 */
router.delete("/cases/:caseId/memory-book/entries/:entryId", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const entry = await loadEntry(parseId(req.params.entryId), row.id, home.id);

  await db.delete(memoryEntriesTable).where(eq(memoryEntriesTable.id, entry.id));

  res.status(204).end();
});

/**
 * The book itself.
 *
 * Shared with the family route, which renders exactly the same document —
 * there is no staff edition and no watermarked family preview, and the one
 * function is how that stays true.
 */
export async function renderBookFor(options: {
  case: Case;
  home: FuneralHome;
}): Promise<string> {
  const book = await loadOrCreateBook(options.case.id, options.home.id);

  return renderMemoryBook(
    await loadBookContents({ book, case: options.case, home: options.home }),
  );
}

router.get("/cases/:caseId/memory-book/render", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  const html = await renderBookFor({ case: row, home });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // One family's photographs, in one file. Never cached by a shared proxy.
  res.setHeader("Cache-Control", "private, no-store");
  res.send(html);
});

export default router;

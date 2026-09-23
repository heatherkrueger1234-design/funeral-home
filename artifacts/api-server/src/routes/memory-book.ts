import { Router, type IRouter } from "express";
import { and, asc, count, eq, max } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  casePhotosTable,
  memoryBooksTable,
  memoryEntriesTable,
  lifeChaptersTable,
  MEMORY_MAX_LENGTH,
  MEMORY_BOOK_MAX_PHOTOS,
  EULOGY_MAX_LENGTH,
  LIFE_CHAPTER_MAX_LENGTH,
  type LifeChapter,
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
const entryShape = {
  kind: z.enum(["memory", "eulogy"]).optional(),
  body: z.string().trim().min(1).max(EULOGY_MAX_LENGTH),
  whenText: z.string().trim().max(120).nullable().optional(),
  photoId: z.number().int().positive().nullable().optional(),
};

/**
 * The length ceiling depends on which it is.
 *
 * A eulogy runs to fifteen hundred words and a memory to a paragraph. One
 * limit for both would either cut a eulogy off mid-sentence or invite an
 * essay into the memories, so the check is a refinement rather than a
 * `max()` — and it lives in a function because it is applied to four
 * schemas that cannot share a base once refined.
 */
function checkEntryLength(
  values: { kind?: "memory" | "eulogy" | undefined; body?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (values.body === undefined) return;
  if ((values.kind ?? "memory") !== "memory") return;
  if (values.body.length <= MEMORY_MAX_LENGTH) return;

  ctx.addIssue({
    code: z.ZodIssueCode.too_big,
    maximum: MEMORY_MAX_LENGTH,
    type: "string",
    inclusive: true,
    path: ["body"],
    message:
      `A memory can run to ${MEMORY_MAX_LENGTH} characters. If this is a ` +
      `eulogy, send it as one and it can be much longer.`,
  });
}

/**
 * The two things the memory book needs to know about a photograph.
 *
 * Both fields are in `openapi.yaml` and so in the generated photo bodies,
 * but this is still parsed alongside them: the generated validators drop
 * OpenAPI's `integer` (see `lib/http.ts`), and a year has to be a whole one.
 */
export const PhotoDatingBody = z.object({
  /*
   * A year, not a date. What is written on the back of a photograph is
   * "1974"; asking for a day and a month produces a guess dressed as a
   * fact, or much more often a blank field.
   */
  takenYear: z.number().int().min(1800).max(2200).nullable().optional(),
  takenAtService: z.boolean().optional(),
});

export const memoryEntryBaseSchema = z.object(entryShape);
export const memoryEntryInputSchema =
  memoryEntryBaseSchema.superRefine(checkEntryLength);
export const memoryEntryUpdateSchema = memoryEntryBaseSchema
  .partial()
  .superRefine(checkEntryLength);

/** A chapter needs a year, a title or something written in it. */
const chapterShape = {
  title: z.string().trim().max(160).nullable().optional(),
  body: z.string().trim().max(LIFE_CHAPTER_MAX_LENGTH).nullable().optional(),
  /*
   * Years, not dates. 1800 is comfortably before anybody whose funeral
   * this software will arrange, and the upper bound keeps a mistyped 20226
   * out of a chronology rather than sorting it to the end of the century.
   */
  startYear: z.number().int().min(1800).max(2200).nullable().optional(),
  endYear: z.number().int().min(1800).max(2200).nullable().optional(),
  photoId: z.number().int().positive().nullable().optional(),
};

export function assertSaneYears(values: {
  startYear?: number | null | undefined;
  endYear?: number | null | undefined;
}): void {
  if (
    values.startYear != null &&
    values.endYear != null &&
    values.endYear < values.startYear
  ) {
    throw badRequest("That chapter ends before it starts.");
  }
}

export const lifeChapterInputSchema = z
  .object(chapterShape)
  .refine(
    (values) =>
      Boolean(values.title?.trim()) ||
      Boolean(values.body?.trim()) ||
      values.startYear != null,
    {
      message:
        "A chapter needs a title, something written in it, or a year — " +
        "otherwise there is nothing to print.",
    },
  );

export const lifeChapterUpdateSchema = z.object(chapterShape);

const BookSettingsBody = z.object({
  title: z.string().trim().max(160).nullable().optional(),
  dedication: z.string().trim().max(1000).nullable().optional(),

  /* Which sections print. All default on; an empty one prints nothing. */
  includePhotos: z.boolean().optional(),
  includeObituary: z.boolean().optional(),
  includeLifeStory: z.boolean().optional(),
  includeCelebration: z.boolean().optional(),
  includeEulogies: z.boolean().optional(),
  includeServicePhotos: z.boolean().optional(),

  /* The day itself. When and where come off the case, not from here. */
  serviceOrder: z.string().trim().max(4000).nullable().optional(),
  music: z.string().trim().max(2000).nullable().optional(),
  bearers: z.string().trim().max(2000).nullable().optional(),
  reception: z.string().trim().max(2000).nullable().optional(),

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
    includeLifeStory: book.includeLifeStory,
    includeCelebration: book.includeCelebration,
    includeEulogies: book.includeEulogies,
    includeServicePhotos: book.includeServicePhotos,
    serviceOrder: book.serviceOrder,
    music: book.music,
    bearers: book.bearers,
    reception: book.reception,
  };
}

export function toChapterJson(chapter: LifeChapter) {
  return {
    id: chapter.id,
    title: chapter.title,
    body: chapter.body,
    startYear: chapter.startYear,
    endYear: chapter.endYear,
    photoId: chapter.photoId,
    authorName: chapter.authorName,
    authorSide: chapter.authorSide,
    authorContactId: chapter.authorContactId,
    includedInBook: chapter.includedInBook,
    position: chapter.position,
    createdAt: chapter.createdAt,
  };
}

export function toEntryJson(entry: MemoryEntry) {
  return {
    id: entry.id,
    kind: entry.kind,
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

  const chapters = await db
    .select()
    .from(lifeChaptersTable)
    .where(
      and(
        eq(lifeChaptersTable.caseId, row.id),
        eq(lifeChaptersTable.funeralHomeId, home.id),
      ),
    )
    .orderBy(asc(lifeChaptersTable.startYear), asc(lifeChaptersTable.position));

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
    chapters: chapters.map(toChapterJson),
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
const StaffEntryBody = memoryEntryBaseSchema
  .extend({
    authorName: z.string().trim().min(1).max(120),
  })
  .superRefine(checkEntryLength);

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
      kind: values.kind ?? "memory",
      body: values.body,
      whenText: values.whenText ?? null,
      photoId: values.photoId ?? null,
      position: await nextMemoryPosition(row.id),
    })
    .returning();

  res.status(201).json(toEntryJson(created!));
});

const StaffEntryUpdate = z.object({
  body: z.string().trim().min(1).max(EULOGY_MAX_LENGTH).optional(),
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


/* -------------------------------------------------------- life story -- */

/**
 * The life, from birth, written by whoever knows a piece of it.
 *
 * The director's side exists because a family who have just buried their
 * mother will not sit down and write her childhood that week — but the
 * aftercare year gives them nine months to, a paragraph at a time, and the
 * home is the one who can put the first few in from what it was told at the
 * arrangement conference.
 */

export async function nextChapterPosition(caseId: number): Promise<number> {
  const [row] = await db
    .select({ highest: max(lifeChaptersTable.position) })
    .from(lifeChaptersTable)
    .where(eq(lifeChaptersTable.caseId, caseId));

  return (row?.highest ?? 0) + 1;
}

const StaffChapterBody = z.object({
  ...chapterShape,
  authorName: z.string().trim().min(1).max(120).optional(),
});

router.post("/cases/:caseId/memory-book/chapters", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  await loadOrCreateBook(row.id, home.id);

  const values = parseBody(StaffChapterBody, req.body);
  assertSaneYears(values);
  await assertPhotoBelongs(values.photoId, row.id, home.id);

  if (!values.title?.trim() && !values.body?.trim() && values.startYear == null) {
    throw badRequest(
      "A chapter needs a title, something written in it, or a year — " +
        "otherwise there is nothing to print.",
    );
  }

  const [created] = await db
    .insert(lifeChaptersTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      title: values.title ?? null,
      body: values.body ?? null,
      startYear: values.startYear ?? null,
      endYear: values.endYear ?? null,
      photoId: values.photoId ?? null,
      // Whose account of it this is, not who typed it — the same rule the
      // memories follow, for the same reason.
      authorName: values.authorName ?? (user.displayName ?? user.email),
      authorSide: "staff",
      authorUserId: user.id,
      position: await nextChapterPosition(row.id),
    })
    .returning();

  res.status(201).json(toChapterJson(created!));
});

async function loadChapter(
  chapterId: number,
  caseId: number,
  funeralHomeId: number,
): Promise<LifeChapter> {
  const [chapter] = await db
    .select()
    .from(lifeChaptersTable)
    .where(
      and(
        eq(lifeChaptersTable.id, chapterId),
        eq(lifeChaptersTable.caseId, caseId),
        eq(lifeChaptersTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  return requireRow(chapter, "That chapter could not be found.");
}

const StaffChapterUpdate = z.object({
  ...chapterShape,
  position: z.number().int().min(0).optional(),
  includedInBook: z.boolean().optional(),
  excludedReason: z.string().trim().max(400).nullable().optional(),
});

router.put("/cases/:caseId/memory-book/chapters/:chapterId", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const chapter = await loadChapter(
    parseId(req.params.chapterId),
    row.id,
    home.id,
  );

  const values = assertHasUpdates(parseBody(StaffChapterUpdate, req.body));
  assertSaneYears({
    startYear: values.startYear ?? chapter.startYear,
    endYear: values.endYear ?? chapter.endYear,
  });
  await assertPhotoBelongs(values.photoId, row.id, home.id);

  const now = new Date();

  const [updated] = await db
    .update(lifeChaptersTable)
    .set({
      ...values,
      ...(values.includedInBook === undefined
        ? {}
        : values.includedInBook
          ? { excludedAt: null, excludedReason: null }
          : { excludedAt: chapter.excludedAt ?? now }),
      updatedAt: now,
    })
    .where(eq(lifeChaptersTable.id, chapter.id))
    .returning();

  res.json(toChapterJson(updated!));
});

router.delete("/cases/:caseId/memory-book/chapters/:chapterId", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const chapter = await loadChapter(
    parseId(req.params.chapterId),
    row.id,
    home.id,
  );

  await db.delete(lifeChaptersTable).where(eq(lifeChaptersTable.id, chapter.id));

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

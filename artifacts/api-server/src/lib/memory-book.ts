import sharp from "sharp";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  casePhotosTable,
  familyContactsTable,
  memoryBooksTable,
  memoryEntriesTable,
  lifeChaptersTable,
  obituaryDraftsTable,
  uploadsTable,
  ageInYear,
  decedentDisplayName,
  MEMORY_BOOK_MAX_PHOTOS,
  MEMORY_BOOK_IMAGE_BUDGET_BYTES,
  type Case,
  type CasePhoto,
  type FuneralHome,
  type LifeChapter,
  type MemoryBook,
  type MemoryEntry,
} from "@workspace/db";
import { decryptBuffer } from "@workspace/db/crypto";
import { logger } from "./logger";

/**
 * Turning a case's photographs and its family's memories into a book.
 *
 * Same output as the rest of the print pipeline and for the same three
 * reasons set out in `print-render.ts`: HTML with physical units and a
 * `@page` rule, because every browser already has a competent PDF writer
 * behind Ctrl-P, because somebody should look at it before two hundred are
 * printed, and because it can be emailed to the print shop as one file.
 *
 * Where it differs from `print-render.ts` is that a card is a fixed layout
 * with named slots and a book is not. The page count is whatever the family
 * wrote. So this is its own renderer rather than a seventh entry in
 * `PRINT_TEMPLATES`, and what a director chooses is what goes *in* it, never
 * where anything sits -- which is the same rule, kept the same way.
 */

/** Half-letter, saddle-stitched. The trade size for a memorial booklet. */
const PAGE_WIDTH = 5.5;
const PAGE_HEIGHT = 8.5;

/**
 * Long edge for an embedded photograph, in pixels.
 *
 * 1400 across a 4.5-inch printable width is about 310dpi, which is past
 * what any press needs and well past what a family's inkjet will do. The
 * stored original stays at 3000 for the print shop that asks; embedding
 * that here would produce a file nobody can open.
 */
const EMBED_EDGE = 1400;
const EMBED_QUALITY = 76;

/**
 * Whether the book has taken as many photographs as it can carry.
 *
 * Split out and exported so the two ceilings can be checked without
 * building a sixty-photograph case. In practice the byte budget is the one
 * that bites: real photographs out of a real bin run around 600KB once
 * downscaled, so the file hits twenty-four megabytes at roughly forty
 * pictures and never reaches the count at all. The count is the backstop
 * for a case full of small ones.
 */
export function bookIsFull(embeddedCount: number, bytesSpent: number): boolean {
  return (
    embeddedCount >= MEMORY_BOOK_MAX_PHOTOS ||
    bytesSpent >= MEMORY_BOOK_IMAGE_BUDGET_BYTES
  );
}

/* ------------------------------------------------------------- loading -- */

export type BookPhoto = {
  id: number;
  caption: string | null;
  /** "1974 · aged 36", or just the year, or empty. Built once, here. */
  dateline: string;
  dataUri: string;
};

export type BookMemory = MemoryEntry & {
  photo: BookPhoto | null;
};

export type BookChapter = LifeChapter & {
  photo: BookPhoto | null;
  /** "1961" or "1961–1990". Empty when the chapter carries no years. */
  years: string;
};

/** The day itself, assembled from the case and the book's own fields. */
export type BookCelebration = {
  when: string | null;
  where: string | null;
  serviceOrder: string | null;
  music: string | null;
  bearers: string | null;
  reception: string | null;
  /** False when nobody filled any of it in, so the page is skipped. */
  any: boolean;
};

export type BookContents = {
  book: MemoryBook;
  case: Case;
  home: FuneralHome;
  coverPhoto: BookPhoto | null;
  obituary: string | null;
  chapters: BookChapter[];
  /** The life, in the order it was lived where anybody dated it. */
  photos: BookPhoto[];
  celebration: BookCelebration;
  eulogies: BookMemory[];
  memories: BookMemory[];
  /** Taken at the funeral. Printed at the back, with the day. */
  servicePhotos: BookPhoto[];
  /** True when a photograph was left out to keep the file openable. */
  photosTruncated: boolean;
  /** Roughly the finished file size, in bytes. */
  approximateBytes: number;
};

/**
 * Decrypt one upload and shrink it for embedding.
 *
 * Returns null rather than throwing on anything unreadable. A book with one
 * missing picture still prints and is still worth having; a 500 in the
 * middle of a family trying to print their mother's memorial book is not a
 * trade this makes. The same judgement `dataUri` makes in `print.ts`.
 */
async function embedPhoto(uploadId: number): Promise<string | null> {
  const [upload] = await db
    .select()
    .from(uploadsTable)
    .where(eq(uploadsTable.id, uploadId))
    .limit(1);

  if (!upload) return null;

  try {
    const bytes = decryptBuffer(upload.data);

    // GIFs are left alone everywhere else in this codebase because they are
    // usually a short animation somebody meant to keep. In print they are a
    // single frame anyway, so the first frame is what gets embedded.
    const shrunk = await sharp(bytes, { failOn: "none", animated: false })
      .rotate()
      .resize({
        width: EMBED_EDGE,
        height: EMBED_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: EMBED_QUALITY })
      .toBuffer();

    return `data:image/jpeg;base64,${shrunk.toString("base64")}`;
  } catch (err) {
    logger.warn({ err, uploadId }, "Could not embed a photograph in a book");
    return null;
  }
}

/** The obituary, if there is one worth printing. */
function obituaryText(row: {
  status: string;
  draftText: string | null;
  biography: string | null;
} | undefined): string | null {
  if (!row) return null;

  /*
   * The approved text if it has been approved, otherwise the biography the
   * family wrote. Deliberately *not* a half-finished draft: a book is
   * permanent, and printing a paragraph somebody abandoned mid-sentence
   * eight months ago into it is worse than leaving the page out.
   */
  const text =
    row.status === "approved"
      ? (row.draftText?.trim() || row.biography?.trim())
      : row.biography?.trim();

  return text && text.length > 0 ? text : null;
}

/** "1974 · aged 36", "1974", or nothing at all. */
function datelineFor(photo: CasePhoto, row: Case): string {
  if (photo.takenYear === null) return "";

  const age = ageInYear(row.dateOfBirth, photo.takenYear);
  return age === null
    ? String(photo.takenYear)
    : `${photo.takenYear} · aged ${age}`;
}

/** "1961", "1961–1990", or nothing. */
function yearsFor(chapter: LifeChapter): string {
  if (chapter.startYear === null) return "";
  if (chapter.endYear === null || chapter.endYear === chapter.startYear) {
    return String(chapter.startYear);
  }
  return `${chapter.startYear}–${chapter.endYear}`;
}

/**
 * The life, in the order it was lived.
 *
 * Dated photographs first, oldest to newest; undated ones after, in the
 * order the family put them in. That fallback is the important half: a book
 * whose photographs nobody has dated comes out in exactly the order it
 * always did, so the progression is something a home opts into by typing
 * years, never something that silently reshuffles a family's arrangement
 * because one picture got a date on it.
 *
 * Undated photographs sort to the back rather than the front for the same
 * reason an undated chapter does — an unplaced picture is a loose end, not
 * a beginning.
 */
function inLifeOrder(photos: CasePhoto[]): CasePhoto[] {
  const dated = photos
    .filter((photo) => photo.takenYear !== null)
    .sort(
      (a, b) =>
        a.takenYear! - b.takenYear! ||
        a.position - b.position ||
        a.id - b.id,
    );

  const undated = photos
    .filter((photo) => photo.takenYear === null)
    .sort((a, b) => a.position - b.position || a.id - b.id);

  return [...dated, ...undated];
}

export async function loadBookContents(options: {
  book: MemoryBook;
  case: Case;
  home: FuneralHome;
}): Promise<BookContents> {
  const { book, home } = options;
  const row = options.case;

  const [obituaryRow] = await db
    .select()
    .from(obituaryDraftsTable)
    .where(eq(obituaryDraftsTable.caseId, row.id))
    .limit(1);

  const entryRows = await db
    .select()
    .from(memoryEntriesTable)
    .where(
      and(
        eq(memoryEntriesTable.caseId, row.id),
        eq(memoryEntriesTable.funeralHomeId, home.id),
        // What the home took out of the book is out of the book. The row
        // stays, so a director can answer "why is mine not in it".
        eq(memoryEntriesTable.includedInBook, true),
      ),
    )
    .orderBy(asc(memoryEntriesTable.position), asc(memoryEntriesTable.id));

  const eulogyRows = book.includeEulogies
    ? entryRows.filter((entry) => entry.kind === "eulogy")
    : [];
  const memoryRows = entryRows.filter((entry) => entry.kind !== "eulogy");

  /*
   * Chapters by year, position only as a tiebreak. A life story written by
   * six relatives over nine months arrives in no order at all, and the
   * decade is the one thing everybody already agrees on.
   */
  const chapterRows = book.includeLifeStory
    ? (
        await db
          .select()
          .from(lifeChaptersTable)
          .where(
            and(
              eq(lifeChaptersTable.caseId, row.id),
              eq(lifeChaptersTable.funeralHomeId, home.id),
              eq(lifeChaptersTable.includedInBook, true),
            ),
          )
      ).sort(
        (a, b) =>
          // Undated chapters to the end: a loose note is a footnote, not a
          // prologue.
          (a.startYear ?? Number.MAX_SAFE_INTEGER) -
            (b.startYear ?? Number.MAX_SAFE_INTEGER) ||
          a.position - b.position ||
          a.id - b.id,
      )
    : [];

  /*
   * The selection, not the bin -- the same rule the photo pack follows. A
   * family may have uploaded four hundred photographs and chosen fifty;
   * the fifty are the ones they wanted people to see.
   */
  const selected = book.includePhotos
    ? await db
        .select()
        .from(casePhotosTable)
        .where(
          and(
            eq(casePhotosTable.caseId, row.id),
            eq(casePhotosTable.funeralHomeId, home.id),
            eq(casePhotosTable.status, "visible"),
            eq(casePhotosTable.selected, true),
          ),
        )
    : [];

  const lifeRows = inLifeOrder(
    selected.filter((photo) => !photo.takenAtService),
  );

  const serviceRows = book.includeServicePhotos
    ? selected
        .filter((photo) => photo.takenAtService)
        .sort((a, b) => a.position - b.position || a.id - b.id)
    : [];

  /*
   * Everything the book might want a picture of, in the order it would be
   * missed if it were dropped: the cover, then the pictures somebody
   * deliberately attached to a chapter or to their own words, then the
   * life plates, then the day.
   *
   * The order matters because of the budget below. A book that ran out of
   * room and dropped the cover, or dropped the snapshot a grandchild chose
   * to go with their paragraph, would have dropped exactly the wrong ones.
   */
  const portraitId = row.portraitPhotoId;

  const attached = [...chapterRows, ...eulogyRows, ...memoryRows]
    .map((entry) => entry.photoId)
    .filter((id): id is number => id !== null);

  const priority: number[] = [];
  for (const id of [
    ...(portraitId === null ? [] : [portraitId]),
    ...attached,
    ...lifeRows.map((photo) => photo.id),
    ...serviceRows.map((photo) => photo.id),
  ]) {
    if (!priority.includes(id)) priority.push(id);
  }

  /*
   * Look them all up in one query. The cover and an attached photograph
   * need not be in the selection at all -- a home that chose a formal
   * portrait for the prayer card and snapshots for the screen has done
   * something sensible.
   */
  const known = new Map(
    [...lifeRows, ...serviceRows].map((photo) => [photo.id, photo]),
  );
  const missing = priority.filter((id) => !known.has(id));

  if (missing.length > 0) {
    const extra = await db
      .select()
      .from(casePhotosTable)
      .where(
        and(
          eq(casePhotosTable.caseId, row.id),
          eq(casePhotosTable.funeralHomeId, home.id),
          eq(casePhotosTable.status, "visible"),
          inArray(casePhotosTable.id, missing),
        ),
      );

    for (const photo of extra) known.set(photo.id, photo);
  }

  /*
   * Embed until the budget runs out.
   *
   * A count alone is not enough: photographs vary from 40KB to 4MB, so
   * "sixty of them" can mean a two-megabyte file or a two-hundred-megabyte
   * one. The book is a single self-contained HTML file, and the number
   * that decides whether a grieving family can actually open it is the
   * total, not the count. Both limits apply and whichever bites first wins.
   */
  const embedded = new Map<number, BookPhoto>();
  let spent = 0;
  let dropped = false;

  for (const photoId of priority) {
    const photo = known.get(photoId);
    if (!photo) continue;

    if (bookIsFull(embedded.size, spent)) {
      dropped = true;
      break;
    }

    const dataUri = await embedPhoto(photo.uploadId);
    if (!dataUri) continue;

    spent += dataUri.length;
    embedded.set(photo.id, {
      id: photo.id,
      caption: photo.caption,
      dateline: datelineFor(photo, row),
      dataUri,
    });
  }

  const plate = (photo: CasePhoto) => embedded.get(photo.id);
  const withPhoto = <T extends { photoId: number | null }>(entry: T) => ({
    ...entry,
    photo: entry.photoId ? (embedded.get(entry.photoId) ?? null) : null,
  });

  const celebration: BookCelebration = {
    when: book.includeCelebration ? formatServiceWhen(row, home) : null,
    where: book.includeCelebration ? row.serviceLocation : null,
    serviceOrder: book.includeCelebration ? book.serviceOrder : null,
    music: book.includeCelebration ? book.music : null,
    bearers: book.includeCelebration ? book.bearers : null,
    reception: book.includeCelebration ? book.reception : null,
    any: false,
  };
  celebration.any = [
    celebration.when,
    celebration.where,
    celebration.serviceOrder,
    celebration.music,
    celebration.bearers,
    celebration.reception,
  ].some((value) => value !== null && value.trim() !== "");

  return {
    book,
    case: row,
    home,
    coverPhoto: portraitId === null ? null : (embedded.get(portraitId) ?? null),
    obituary: book.includeObituary ? obituaryText(obituaryRow) : null,
    chapters: chapterRows.map((chapter) => ({
      ...withPhoto(chapter),
      years: yearsFor(chapter),
    })),
    // The cover is not repeated in the plates: a book that opens with the
    // same picture twice looks like a mistake, because it usually is one.
    photos: lifeRows
      .filter((photo) => photo.id !== portraitId)
      .map(plate)
      .filter((photo): photo is BookPhoto => photo !== undefined),
    celebration,
    eulogies: eulogyRows.map(withPhoto),
    memories: memoryRows.map(withPhoto),
    servicePhotos: serviceRows
      .map(plate)
      .filter((photo): photo is BookPhoto => photo !== undefined),
    photosTruncated: dropped,
    approximateBytes: spent,
  };
}

/** The author names to show against entries, for the staff-side listing. */
export async function contactNamesFor(
  caseId: number,
): Promise<Map<number, string>> {
  const rows = await db
    .select({ id: familyContactsTable.id, name: familyContactsTable.name })
    .from(familyContactsTable)
    .where(eq(familyContactsTable.caseId, caseId));

  return new Map(rows.map((row) => [row.id, row.name]));
}

/* ----------------------------------------------------------- rendering -- */

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Paragraphs, preserving the shape the person typed. */
function paragraphs(value: string): string {
  return esc(value)
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.replace(/\r?\n/g, "<br>")}</p>`)
    .join("\n");
}

function formatDates(row: Case): string {
  const year = (value: Date | null) =>
    value ? String(value.getFullYear()) : "";

  const born = year(row.dateOfBirth);
  const died = year(row.dateOfDeath);

  if (born && died) return `${born} — ${died}`;
  return died;
}

/**
 * "Tuesday, February 3, 2026 at 11:00 AM", or nothing.
 *
 * Rendered in **the home's** timezone, which is the only one that is ever
 * right: the service happened at eleven in the morning in Pueblo, and a
 * book that says six in the evening because the server is on UTC is
 * printing a fact about the day that is simply false — in the one document
 * a family will still have in thirty years.
 */
function formatServiceWhen(row: Case, home: FuneralHome): string | null {
  if (!row.serviceAt) return null;

  try {
    return row.serviceAt.toLocaleString("en-US", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: home.timezone,
    });
  } catch {
    // A timezone the runtime does not know is a misconfigured home, not a
    // reason to fail printing a book. Fall back to the date without a
    // claim about the hour.
    return row.serviceAt.toLocaleDateString("en-US", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }
}

function page(contents: string, className = ""): string {
  return `<section class="page ${className}">${contents}</section>`;
}

export function renderMemoryBook(contents: BookContents): string {
  const { book, home } = contents;
  const row = contents.case;

  const name = decedentDisplayName(row);
  const title = book.title?.trim() || `Remembering ${name}`;
  const dates = formatDates(row);

  const accent = /^#[0-9a-fA-F]{6}$/.test(home.accentColor)
    ? home.accentColor
    : "#1f4e46";

  const pages: string[] = [];

  /* Cover. */
  pages.push(
    page(
      `${
        contents.coverPhoto
          ? `<div class="cover-photo"><img src="${contents.coverPhoto.dataUri}" alt=""></div>`
          : ""
      }
       <h1>${esc(title)}</h1>
       ${dates ? `<p class="dates">${esc(dates)}</p>` : ""}`,
      "page--cover",
    ),
  );

  /* Dedication. Its own page, because that is how a dedication reads. */
  if (book.dedication?.trim()) {
    pages.push(
      page(
        `<div class="dedication">${paragraphs(book.dedication.trim())}</div>`,
        "page--dedication",
      ),
    );
  }

  /* The obituary. */
  if (contents.obituary) {
    pages.push(
      page(
        `<h2>${esc(name)}</h2><div class="prose">${paragraphs(contents.obituary)}</div>`,
        "page--obituary",
      ),
    );
  }

  /*
   * Her life, in the order it happened.
   *
   * A divider only when there is something behind it. Every section below
   * works this way: an empty one prints nothing at all rather than a
   * heading over a blank page, which is what lets all the switches default
   * to on without costing a home that is not using them anything.
   */
  if (contents.chapters.length > 0) {
    pages.push(page(`<h2 class="divider">Her life</h2>`, "page--divider"));

    for (const chapter of contents.chapters) {
      pages.push(
        page(
          `${chapter.years ? `<p class="years">${esc(chapter.years)}</p>` : ""}
           ${chapter.title ? `<h3>${esc(chapter.title)}</h3>` : ""}
           ${
             chapter.photo
               ? `<div class="memory-photo"><img src="${chapter.photo.dataUri}" alt=""></div>`
               : ""
           }
           ${chapter.body ? `<div class="prose">${paragraphs(chapter.body)}</div>` : ""}`,
          "page--chapter",
        ),
      );
    }
  }

  /*
   * Plates: one photograph to a page, with whatever the family captioned
   * it and — where somebody typed a year — how old she was in it. The
   * second line is the whole point of dating them: "1974, aged 36" is the
   * caption a family wants and cannot work out forty times over.
   */
  for (const photo of contents.photos) {
    pages.push(
      page(
        `<figure>
           <img src="${photo.dataUri}" alt="">
           ${
             photo.caption || photo.dateline
               ? `<figcaption>
                    ${photo.caption ? esc(photo.caption) : ""}
                    ${photo.dateline ? `<span class="dateline">${esc(photo.dateline)}</span>` : ""}
                  </figcaption>`
               : ""
           }
         </figure>`,
        "page--plate",
      ),
    );
  }

  /* The day itself. */
  if (contents.celebration.any) {
    const line = (label: string, value: string | null) =>
      value && value.trim()
        ? `<div class="detail"><dt>${esc(label)}</dt><dd>${paragraphs(value.trim())}</dd></div>`
        : "";

    pages.push(
      page(
        `<h2>A celebration of her life</h2>
         <dl class="details">
           ${line("When", contents.celebration.when)}
           ${line("Where", contents.celebration.where)}
           ${line("The order of the day", contents.celebration.serviceOrder)}
           ${line("Music", contents.celebration.music)}
           ${line("Carried by", contents.celebration.bearers)}
           ${line("Afterwards", contents.celebration.reception)}
         </dl>`,
        "page--celebration",
      ),
    );
  }

  /*
   * Eulogies: what somebody stood up and read.
   *
   * These are the one thing in the book allowed to run over a page. A
   * eulogy is fifteen hundred words and breaking it into fixed pages would
   * either cut it mid-sentence or shrink it to six point; `page--flow`
   * lets it take the pages it needs.
   */
  if (contents.eulogies.length > 0) {
    pages.push(page(`<h2 class="divider">Eulogies</h2>`, "page--divider"));

    for (const eulogy of contents.eulogies) {
      pages.push(
        page(
          `<h3>Read by ${esc(eulogy.authorName)}</h3>
           ${
             eulogy.photo
               ? `<div class="memory-photo"><img src="${eulogy.photo.dataUri}" alt=""></div>`
               : ""
           }
           <div class="prose">${paragraphs(eulogy.body)}</div>`,
          "page--eulogy page--flow",
        ),
      );
    }
  }

  /* The memories. */
  if (contents.memories.length > 0) {
    pages.push(page(`<h2 class="divider">Memories</h2>`, "page--divider"));

    for (const memory of contents.memories) {
      const attribution = [
        esc(memory.authorName),
        memory.whenText ? esc(memory.whenText) : "",
      ]
        .filter(Boolean)
        .join(" · ");

      pages.push(
        page(
          `${
            memory.photo
              ? `<div class="memory-photo"><img src="${memory.photo.dataUri}" alt=""></div>`
              : ""
          }
           <div class="prose">${paragraphs(memory.body)}</div>
           <p class="attribution">${attribution}</p>`,
          "page--memory",
        ),
      );
    }
  }

  /* Photographs from the day. */
  if (contents.servicePhotos.length > 0) {
    pages.push(page(`<h2 class="divider">The day</h2>`, "page--divider"));

    for (const photo of contents.servicePhotos) {
      pages.push(
        page(
          `<figure>
             <img src="${photo.dataUri}" alt="">
             ${photo.caption ? `<figcaption>${esc(photo.caption)}</figcaption>` : ""}
           </figure>`,
          "page--plate",
        ),
      );
    }
  }

  /* The home's mark, last. Quiet, and the only place it appears. */
  pages.push(
    page(
      `<p class="colophon">Kept in care with ${esc(home.name)}</p>`,
      "page--colophon",
    ),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  /*
   * Half-letter pages, and no margin on the page box: the margin lives
   * inside .page instead, so a photograph can run to the edge without the
   * browser's own print margin fighting it. Two of these impose on a letter
   * sheet, which is how a booklet is actually printed.
   */
  @page { size: ${PAGE_WIDTH}in ${PAGE_HEIGHT}in; margin: 0; }

  :root { --accent: ${accent}; }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: Georgia, "Times New Roman", serif;
    color: #1a1a1a;
    background: #f4f2ef;
    font-size: 11pt;
    line-height: 1.5;
  }

  .page {
    width: ${PAGE_WIDTH}in;
    height: ${PAGE_HEIGHT}in;
    padding: 0.6in 0.5in;
    background: #fff;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    overflow: hidden;
    break-inside: avoid;
    page-break-inside: avoid;
    position: relative;
    /* Screen only: a stack of sheets. In print each one is its own page. */
    margin: 0 auto 0.25in;
    box-shadow: 0 1px 6px rgba(0,0,0,.14);
  }

  .page + .page { page-break-before: always; }

  h1 {
    font-size: 21pt;
    font-weight: 600;
    line-height: 1.15;
    margin: 0.18in 0 0.04in;
  }

  h2 {
    font-size: 12pt;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 0.16in;
    font-weight: 600;
  }

  .dates { font-size: 12pt; color: #555; margin: 0; }

  .cover-photo img {
    max-width: 3.6in;
    max-height: 4.4in;
    object-fit: contain;
  }

  /* Prose is the one thing that is not centred: a paragraph of somebody's
     memory set centred is unreadable past about two lines. */
  .prose, .dedication {
    text-align: left;
    width: 100%;
    /* Long words and pasted URLs must not push a page wider than the trim. */
    overflow-wrap: break-word;
  }

  .prose p, .dedication p { margin: 0 0 0.14in; }

  .dedication {
    font-style: italic;
    text-align: center;
    font-size: 12pt;
  }

  .page--obituary, .page--memory { justify-content: flex-start; }

  figure { margin: 0; width: 100%; }

  figure img {
    max-width: 100%;
    max-height: 6.4in;
    object-fit: contain;
  }

  figcaption {
    margin-top: 0.12in;
    font-size: 9.5pt;
    color: #555;
    font-style: italic;
  }

  .memory-photo { width: 100%; margin-bottom: 0.18in; }

  .memory-photo img {
    max-width: 100%;
    max-height: 3.2in;
    object-fit: contain;
  }

  .attribution {
    margin-top: auto;
    padding-top: 0.16in;
    font-size: 9.5pt;
    color: #555;
    align-self: flex-end;
    font-style: italic;
  }

  .divider {
    font-size: 14pt;
    border-top: 1px solid var(--accent);
    border-bottom: 1px solid var(--accent);
    padding: 0.12in 0.3in;
  }

  h3 {
    font-size: 13pt;
    font-weight: 600;
    margin: 0 0 0.14in;
  }

  /* The year a chapter covers, set above its title like a dateline. */
  .years {
    font-size: 9.5pt;
    letter-spacing: .1em;
    color: var(--accent);
    margin: 0 0 0.06in;
  }

  .page--chapter, .page--eulogy, .page--celebration {
    justify-content: flex-start;
  }

  /*
   * A eulogy is fifteen hundred words and will not fit a half-letter page.
   * Letting it flow is the only honest option: breaking it at a fixed page
   * would cut it mid-sentence, and shrinking it to fit would set somebody's
   * eulogy for their mother in six point.
   */
  .page--flow {
    height: auto;
    min-height: ${PAGE_HEIGHT}in;
    break-inside: auto;
    page-break-inside: auto;
  }

  /* The year and age under a photograph, below the family's own caption. */
  .dateline {
    display: block;
    margin-top: 0.03in;
    font-style: normal;
    letter-spacing: .06em;
    color: #777;
    font-size: 8.5pt;
  }

  .details { width: 100%; text-align: left; margin: 0; }

  .detail + .detail { margin-top: 0.16in; }

  .details dt {
    font-size: 8.5pt;
    letter-spacing: .09em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 0.03in;
  }

  .details dd { margin: 0; }

  .details dd p { margin: 0 0 0.06in; }

  .colophon { font-size: 9.5pt; color: #666; margin: 0; }

  @media print {
    body { background: #fff; }
    .page { margin: 0; box-shadow: none; }
  }
</style>
</head>
<body>
${pages.join("\n")}
</body>
</html>`;
}

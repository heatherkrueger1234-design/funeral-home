import sharp from "sharp";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  casePhotosTable,
  familyContactsTable,
  memoryBooksTable,
  memoryEntriesTable,
  obituaryDraftsTable,
  uploadsTable,
  decedentDisplayName,
  MEMORY_BOOK_MAX_PHOTOS,
  MEMORY_BOOK_IMAGE_BUDGET_BYTES,
  type Case,
  type FuneralHome,
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
  dataUri: string;
};

export type BookMemory = MemoryEntry & {
  photo: BookPhoto | null;
};

export type BookContents = {
  book: MemoryBook;
  case: Case;
  home: FuneralHome;
  coverPhoto: BookPhoto | null;
  obituary: string | null;
  photos: BookPhoto[];
  memories: BookMemory[];
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

  const memoryRows = await db
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

  /*
   * The selection, not the bin -- the same rule the photo pack follows. A
   * family may have uploaded four hundred photographs and chosen fifty;
   * the fifty are the ones they wanted people to see, already in order.
   */
  const plateRows = book.includePhotos
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
        .orderBy(asc(casePhotosTable.position), asc(casePhotosTable.id))
    : [];

  /*
   * Everything the book might want a picture of, in the order it would be
   * missed if it were dropped: the cover first, then the photograph
   * somebody attached to their own memory, then the plates.
   *
   * The order matters because of the budget below. A book that ran out of
   * room and dropped the cover, or dropped the snapshot a grandchild chose
   * to go with their paragraph, would have dropped exactly the wrong ones.
   */
  const portraitId = row.portraitPhotoId;
  const memoryPhotoIds = memoryRows
    .map((entry) => entry.photoId)
    .filter((id): id is number => id !== null);

  const priority: number[] = [];
  for (const id of [
    ...(portraitId === null ? [] : [portraitId]),
    ...memoryPhotoIds,
    ...plateRows.map((photo) => photo.id),
  ]) {
    if (!priority.includes(id)) priority.push(id);
  }

  /*
   * Look them all up in one query. The plates are already loaded, but the
   * cover and a memory's photograph need not be in the selection at all --
   * a home that chose a formal portrait for the prayer card and snapshots
   * for the screen has done something sensible.
   */
  const known = new Map(plateRows.map((photo) => [photo.id, photo]));
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
      dataUri,
    });
  }

  const coverPhoto =
    portraitId === null ? null : (embedded.get(portraitId) ?? null);

  return {
    book,
    case: row,
    home,
    coverPhoto,
    obituary: book.includeObituary ? obituaryText(obituaryRow) : null,
    // The cover is not repeated in the plates: a book that opens with the
    // same picture twice looks like a mistake, because it usually is one.
    photos: plateRows
      .filter((photo) => photo.id !== portraitId)
      .map((photo) => embedded.get(photo.id))
      .filter((photo): photo is BookPhoto => photo !== undefined),
    memories: memoryRows.map((entry) => ({
      ...entry,
      photo: entry.photoId ? (embedded.get(entry.photoId) ?? null) : null,
    })),
    photosTruncated: dropped,
    /** Roughly how big the finished file is, for the director's warning. */
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

  /* Plates. One photograph to a page, with whatever the family captioned it. */
  for (const photo of contents.photos) {
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

  /* The memories. */
  if (contents.memories.length > 0) {
    pages.push(
      page(`<h2 class="divider">Memories</h2>`, "page--divider"),
    );

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

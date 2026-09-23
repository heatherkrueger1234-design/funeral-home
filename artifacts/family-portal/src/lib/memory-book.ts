/**
 * The small rules the memory book page has to agree with the server about.
 *
 * Kept out of the page so they can be tested without rendering anything, and
 * written out here rather than imported because the portal does not depend
 * on the database package. The numbers are the ones in
 * `lib/db/src/schema/memories.ts`, and the server is still the one that
 * enforces them: what this file is for is telling somebody *before* they
 * press the button, so a paragraph about their mother is never the thing
 * that comes back refused.
 */

export type EntryKind = "memory" | "eulogy";

/** Roughly a page of typing. */
export const MEMORY_MAX_LENGTH = 4000;

/**
 * A eulogy is a different thing at a different length: what somebody stood
 * up and read runs to fifteen hundred words, and one limit for both would
 * cut a eulogy off mid-sentence or invite an essay into the memories.
 */
export const EULOGY_MAX_LENGTH = 20000;

export const LIFE_CHAPTER_MAX_LENGTH = 6000;
export const WHEN_MAX_LENGTH = 120;
export const CHAPTER_TITLE_MAX_LENGTH = 160;

export const YEAR_MIN = 1800;
export const YEAR_MAX = 2200;

export function bodyLimit(kind: EntryKind): number {
  return kind === "eulogy" ? EULOGY_MAX_LENGTH : MEMORY_MAX_LENGTH;
}

/**
 * What is wrong with a memory before it is sent, or null.
 *
 * Measured after trimming, because that is what the server measures.
 */
export function entryProblem(kind: EntryKind, body: string): string | null {
  const length = body.trim().length;

  if (length === 0) return "Write something first.";

  if (length > bodyLimit(kind)) {
    return kind === "memory"
      ? `A memory can be up to ${MEMORY_MAX_LENGTH.toLocaleString("en-US")} characters. If this is something that was read at the service, choose that instead and it can be much longer.`
      : `This can be up to ${EULOGY_MAX_LENGTH.toLocaleString("en-US")} characters.`;
  }

  return null;
}

export type YearResult =
  | { ok: true; value: number | null }
  | { ok: false; message: string };

/**
 * A year typed into a box: blank is fine, "1974" is fine, anything else is
 * said plainly rather than sent to be refused.
 */
export function parseYear(input: string): YearResult {
  const text = input.trim();
  if (text === "") return { ok: true, value: null };

  if (!/^\d{4}$/.test(text)) {
    return { ok: false, message: "A year, like 1974." };
  }

  const value = Number(text);
  if (value < YEAR_MIN || value > YEAR_MAX) {
    return { ok: false, message: "That year doesn't look right." };
  }

  return { ok: true, value };
}

/** "1961", "1961–1990", or nothing — the way the printed book shows it. */
export function yearsLabel(
  startYear: number | null | undefined,
  endYear: number | null | undefined,
): string | null {
  // Matches the renderer, which prints no years at all without a start.
  if (startYear == null) return null;
  if (endYear == null || endYear === startYear) return String(startYear);
  return `${startYear}–${endYear}`;
}

/**
 * What is wrong with a chapter before it is sent, or null.
 *
 * The same two rules the server applies: a chapter needs *something* in it
 * to print, and it cannot end before it starts.
 */
export function chapterProblem(values: {
  title: string;
  body: string;
  startYear: number | null;
  endYear: number | null;
}): string | null {
  if (!values.title.trim() && !values.body.trim() && values.startYear === null) {
    return "Give it a title, a year, or a few words.";
  }

  if (values.body.trim().length > LIFE_CHAPTER_MAX_LENGTH) {
    return `A chapter can be up to ${LIFE_CHAPTER_MAX_LENGTH.toLocaleString("en-US")} characters. It could be split into two.`;
  }

  // Allowed by the server, but the book prints no years without a start,
  // so an end year on its own would silently vanish from the page.
  if (values.startYear === null && values.endYear !== null) {
    return "Add the year it began as well.";
  }

  if (
    values.startYear !== null &&
    values.endYear !== null &&
    values.endYear < values.startYear
  ) {
    return "That ends before it starts.";
  }

  return null;
}

/**
 * The server's own sentence, without the "HTTP 409 Conflict:" the API client
 * puts in front of it. The sentences are written for families; the prefix
 * is not.
 */
export function plainError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const stripped = message.replace(/^HTTP \d{3}[^:]*:\s*/, "").trim();
  return stripped || "That didn't save. Please try again.";
}

/** A 409 from any write here means the book was closed while they typed. */
export function isClosedBook(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 409;
}

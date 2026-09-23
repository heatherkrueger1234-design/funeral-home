/**
 * The arithmetic behind the memory book tab, kept out of the component so it
 * can be tested without rendering one.
 */

/** Anything with an id and a place in the book. */
type Positioned = { id: number; position: number };

/**
 * The writes needed to move one row up or down a list, as `{ id, position }`.
 *
 * The list is renumbered 1..n in its new order and only the rows whose number
 * actually changed are returned — ordinarily the two that swapped. Swapping
 * the two stored positions would be shorter and is wrong: positions tie (two
 * rows at 0 from an older import, or two chapters added in the same second
 * by two relatives), and swapping two equal numbers moves nothing. The
 * server breaks a tie on id, so the list as the director sees it is the
 * truth, and numbering that list is the only move that always lands.
 *
 * `canSwap` says whether the neighbour is one this row may trade places
 * with. The life story needs it: chapters print by year, and position only
 * breaks a tie inside a year, so moving 1974 above 1961 would be a write the
 * book then ignores.
 */
export function moveWrites<T extends Positioned>(
  rows: readonly T[],
  id: number,
  direction: -1 | 1,
  canSwap: (a: T, b: T) => boolean = () => true,
): Array<{ id: number; position: number }> {
  const from = rows.findIndex((row) => row.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= rows.length) return [];
  if (!canSwap(rows[from]!, rows[to]!)) return [];

  return swapWrites(rows, rows[from]!.id, rows[to]!.id);
}

/**
 * Swap two rows anywhere in a list and renumber it, as above.
 *
 * For the entries, which the tab shows as two lists — memories and eulogies —
 * that share one sequence of positions: the neighbour is found in the list
 * on screen, and the renumbering runs over all of them.
 */
export function swapWrites<T extends Positioned>(
  rows: readonly T[],
  a: number,
  b: number,
): Array<{ id: number; position: number }> {
  const i = rows.findIndex((row) => row.id === a);
  const j = rows.findIndex((row) => row.id === b);
  if (i < 0 || j < 0 || i === j) return [];

  const next = [...rows];
  [next[i], next[j]] = [next[j]!, next[i]!];

  return next.flatMap((row, index) =>
    row.position === index + 1 ? [] : [{ id: row.id, position: index + 1 }],
  );
}

/** Whether two chapters sit in the same year, and so may change places. */
export function sameYear(
  a: { startYear: number | null },
  b: { startYear: number | null },
): boolean {
  return a.startYear === b.startYear;
}

/** "1961", "1961–1990", or nothing — as the printed book shows it. */
export function yearsLabel(startYear: number | null, endYear: number | null): string {
  if (startYear === null) return "";
  if (endYear === null || endYear === startYear) return String(startYear);
  return `${startYear}–${endYear}`;
}

/**
 * A year typed into a box, or `undefined` when it is not one.
 *
 * Blank is a real answer (null, "nobody knows"), which is why failure is a
 * different value rather than null.
 */
export function readYear(text: string): number | null | undefined {
  const value = text.trim();
  if (value === "") return null;
  if (!/^\d{4}$/.test(value)) return undefined;

  const year = Number(value);
  return year >= 1800 && year <= 2200 ? year : undefined;
}

/**
 * What the book's status line says.
 *
 * `closesAt` in the future is a book that is open with an end date; in the
 * past, a closed one. The server's `open` flag is the authority and this only
 * words it.
 */
export function bookStatus(
  book: { open: boolean; closesAt: string | null },
  format: (date: Date) => string,
): string {
  if (!book.open) {
    return book.closesAt
      ? `Closed for printing on ${format(new Date(book.closesAt))}`
      : "Closed for printing";
  }

  return book.closesAt
    ? `Open until ${format(new Date(book.closesAt))}`
    : "Open — the family can add to it";
}

/** The end of a chosen day, in the home's browser, as an ISO string. */
export function endOfDay(dateInput: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return null;
  const [year, month, day] = dateInput.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day, 23, 59, 59).toISOString();
}

/** A stored date as a `<input type="date">` value, in local time. */
export function toDateInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The hidden doors on the "needs your link" screen.
 *
 * Nothing on that screen says there is a staff entrance, and nothing should:
 * the people who arrive here are families. The doors are for the owner and
 * the people they hand a key to, and they open by clicking things in order,
 * the way a speakeasy's does.
 *
 *   mark, "funeral", "page"      the platform console's sign-in
 *   mark, mark, mark             the funeral home side: its welcome page
 *
 * This is a way of not advertising a door, not a lock. Each place it leads
 * has its own sign-in, and that is what keeps anyone out.
 */

export type Knock = "mark" | "funeral" | "page";
export type Door = "admin" | "home";
type Entry = { knock: Knock; at: number };

/** Ordinary people click slowly; a knock that takes longer is not one. */
export const KNOCK_WINDOW_MS = 8_000;

const SEQUENCES: Array<{ door: Door; knocks: Knock[] }> = [
  { door: "admin", knocks: ["mark", "funeral", "page"] },
  { door: "home", knocks: ["mark", "mark", "mark"] },
];

/** Add one click to what has been clicked, and say whether a door opened. */
export function knock(
  history: Entry[],
  next: Knock,
  now: number,
): { history: Entry[]; door: Door | null } {
  const recent = [...history, { knock: next, at: now }]
    .filter((entry) => now - entry.at <= KNOCK_WINDOW_MS)
    .slice(-3);

  for (const sequence of SEQUENCES) {
    const tail = recent.slice(-sequence.knocks.length);
    if (
      tail.length === sequence.knocks.length &&
      tail.every((entry, index) => entry.knock === sequence.knocks[index])
    ) {
      return { history: [], door: sequence.door };
    }
  }

  return { history: recent, door: null };
}

const origin = (name: string) =>
  ((import.meta.env[name] as string | undefined) ?? "").trim().replace(/\/+$/, "");

/** Where a door leads on this deployment, or null if it was not told. */
export function doorAddress(door: Door): string | null {
  if (door === "admin") return origin("VITE_ADMIN_CONSOLE_URL") || null;
  const console = origin("VITE_CONSOLE_URL");
  return console ? `${console}/welcome` : null;
}

/** Just the two taps on the mark that are not yet a third. */
export function markTappedTwice(history: Entry[]): boolean {
  const tail = history.slice(-2);
  return tail.length === 2 && tail.every((entry) => entry.knock === "mark");
}

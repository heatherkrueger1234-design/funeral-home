import { waitAsked } from "@workspace/api-client-react";

/**
 * How a photograph on the family's pages asks again after it did not arrive.
 *
 * A thumbnail is made the first time anybody asks for it, and the server
 * makes only so many at once; past that it answers "not yet" (429) and says
 * when to come back. Nothing is wrong with the photograph, and it used to be
 * treated as if something were: asked once more a second later, then left
 * as an empty square. So a "not yet" is waited out, as long as it asks, up
 * to ten times. A link that has stopped, or a photograph that has gone, is
 * never asked about again, because the answer cannot change; anything else,
 * most likely a dropped connection, once.
 */
const TIMES_TO_WAIT = 10;

export function askAgainForPhoto(failures: number, error: unknown): boolean {
  if (waitAsked(error) !== null) return failures < TIMES_TO_WAIT;
  const status = (error as { status?: number } | null)?.status;
  if (status === 401 || status === 404) return false;
  return failures < 1;
}

/** As long as a "not yet" asked; otherwise react-query's own doubling wait. */
export function waitBeforeAskingAgain(failures: number, error: unknown): number {
  return waitAsked(error) ?? Math.min(1000 * 2 ** failures, 30_000);
}

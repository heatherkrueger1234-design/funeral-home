import { isForbidden, isUnauthorized } from "@/lib/api";

/** What `/auth/me` answers for whoever is signed in. */
export type Session = { user: { email: string; emailVerified: boolean } };

/**
 * One of the gate's two questions, as react-query holds it. `data` and
 * `error` can both be set at once: a query whose refetch fails keeps the
 * answer it had before.
 */
type Answer<T> = { isPending: boolean; error: unknown; data?: T };

/**
 * What the gate draws, from what it knows so far.
 *
 * "nothing" while either question is still out: drawing the console before
 * the second answer arrived is how a director used to see its whole
 * navigation around an error. "error" is the session question failing for
 * any reason other than being signed out.
 */
export type GateScreen =
  | { screen: "nothing" }
  | { screen: "error" }
  | { screen: "sign-in" }
  | { screen: "not-for-you"; forbidden: boolean; unconfirmed: boolean }
  | { screen: "console"; signedInAs: string };

export function gateScreen(
  session: Answer<Session | null>,
  access: Answer<unknown>,
): GateScreen {
  if (session.isPending) return { screen: "nothing" };

  /*
   * Only a 401 means "signed out". Anything else -- the API restarting, a
   * 500, the network dropping -- used to fall through to the sign-in form,
   * which told a signed-in admin their session was gone and invited them to
   * type their password into a page whose server was not answering.
   */
  if (session.error && !isUnauthorized(session.error)) {
    return { screen: "error" };
  }

  /*
   * Signed out even while it still holds an answer. A query whose refetch
   * fails keeps the data it had, so a session that expired with the console
   * open still "had" a user: the gate let them through, and every panel
   * behind it failed one at a time instead of the sign-in form appearing.
   */
  if (isUnauthorized(session.error) || !session.data) return { screen: "sign-in" };

  if (access.isPending) return { screen: "nothing" };

  if (isUnauthorized(access.error)) return { screen: "sign-in" };

  if (access.error) {
    return {
      screen: "not-for-you",
      forbidden: isForbidden(access.error),
      unconfirmed: !session.data.user.emailVerified,
    };
  }

  return { screen: "console", signedInAs: session.data.user.email };
}

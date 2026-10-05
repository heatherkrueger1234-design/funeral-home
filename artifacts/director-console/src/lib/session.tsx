import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  useGetCurrentUser,
  getGetCurrentUserQueryKey,
  type AuthUser,
} from "@workspace/api-client-react";

/**
 * The signed-in staff member and the home they work at.
 *
 * A cookie session, not a token: unlike the family portal there is a real
 * account here, and an httpOnly cookie keeps the credential out of reach of
 * any script on the page.
 */

type SessionState = {
  session: AuthUser | null;
  isPending: boolean;
  /** Re-read the session after signing in or out. */
  refresh: () => void;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const query = useGetCurrentUser({
    query: {
      queryKey: getGetCurrentUserQueryKey(),
      // A 401 here is the ordinary signed-out case, not a failure worth
      // retrying or reporting.
      retry: false,
    },
  });
  const session = whoIsSignedIn(query);
  const signedInAs = session?.user.id ?? null;

  /*
   * What a session could see goes when it does. The console is often open on
   * a shared office computer; without this, the sign-in form would sit over a
   * cache still holding every case the last person opened, and whoever signed
   * in next would be shown them from it before the server had been asked
   * anything. Signing out from the menu reloads the page, which empties the
   * cache the same way; this is for a session that ended anywhere else.
   *
   * And when it changes hands without ending: somebody else signing in from
   * another tab replaces the cookie this tab uses, and the next answer about
   * who is here names them. The cache is kept by whose answers it holds, so
   * it is emptied then too, and nothing is drawn from it in the meantime --
   * the screens already open belong to the first person, and are taken down
   * with what they fetched rather than shown to the second.
   */
  const [cacheHolds, setCacheHolds] = useState(signedInAs);
  useEffect(() => {
    if (cacheHolds === signedInAs) return;
    if (holdsSomebodyElses(cacheHolds, signedInAs)) forgetCachedAnswers(queryClient);
    setCacheHolds(signedInAs);
  }, [cacheHolds, signedInAs, queryClient]);
  const changingHands = signedInAs !== null && holdsSomebodyElses(cacheHolds, signedInAs);

  return (
    <SessionContext.Provider
      value={{
        session: changingHands ? null : session,
        isPending: query.isPending || changingHands,
        refresh: () => {
          void queryClient.invalidateQueries({
            queryKey: getGetCurrentUserQueryKey(),
          });
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside a SessionProvider");
  return value;
}

/**
 * The home's zone, for `formatAtHome` and the input helpers in `utils.ts`.
 * Undefined only before the session has loaded, where they fall back to the
 * browser's zone rather than failing.
 */
export function useHomeZone(): string | undefined {
  return useSession().session?.home.timezone;
}

/**
 * Who is signed in, from what the session question last answered. `data` and
 * `error` can both be set at once: a query whose refetch fails keeps the
 * answer it had before.
 */
export function whoIsSignedIn<T>(answer: { data?: T; error: unknown }): T | null {
  /*
   * Nobody, even while it still holds an answer. A session that ended
   * somewhere else — signed out in another tab, a password reset, the owner
   * taking this person's access away, thirty days running out — still "had"
   * a user after `/auth/me` said 401, so the sign-in form never came: every
   * case already opened stayed on screen, and saves failed without a word.
   *
   * Only a 401 means that. The API restarting or the network dropping on a
   * re-ask leaves the director where they were, and the next answer decides.
   */
  if (isUnauthorized(answer.error)) return null;
  return answer.data ?? null;
}

export function isUnauthorized(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 401;
}

/** The session query is allowed to fail quietly; nothing else is. */
export function isSessionQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === getGetCurrentUserQueryKey()[0];
}

/**
 * Whether the cache holds answers given to somebody other than whoever is
 * signed in now: they signed out, or somebody else signed in over them.
 * Both are user ids, null for nobody.
 */
export function holdsSomebodyElses(cacheHolds: number | null, signedInAs: number | null): boolean {
  return cacheHolds !== null && cacheHolds !== signedInAs;
}

/**
 * Empty the cache of one person's answers. The session question stays: it
 * holds what the gate is drawn from, and removing it would only ask again,
 * with a blank screen meanwhile.
 */
export function forgetCachedAnswers(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (cached) => !isSessionQuery(cached.queryKey) });
}

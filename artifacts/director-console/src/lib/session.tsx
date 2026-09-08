import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
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

  return (
    <SessionContext.Provider
      value={{
        session: query.data ?? null,
        isPending: query.isPending,
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

export function isUnauthorized(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 401;
}

/** The session query is allowed to fail quietly; nothing else is. */
export function isSessionQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === getGetCurrentUserQueryKey()[0];
}

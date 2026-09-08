import { createContext, useContext, type ReactNode } from "react";
import { reloadToHome } from "@/lib/assets";
import {
  ApiError,
  getGetCurrentUserQueryKey,
  useGetCurrentUser,
  useLogout,
  type AuthUser,
} from "@workspace/api-client-react";

type SessionValue = {
  user: AuthUser | null;
  isLoading: boolean;
  signOut: () => void;
  isSigningOut: boolean;
};

const SessionContext = createContext<SessionValue | null>(null);

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/**
 * True for the "who am I" query. Its failures are expected on the public
 * pages — nobody is signed in there — so they are never surfaced as errors.
 */
export function isSessionQuery(queryKey: readonly unknown[]): boolean {
  const [sessionKey] = getGetCurrentUserQueryKey();
  return queryKey[0] === sessionKey;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useGetCurrentUser({
    query: {
      queryKey: getGetCurrentUserQueryKey(),
      // A 401 is the ordinary "not signed in" answer, not a transient fault,
      // so it must not be retried or cached as a failure worth surfacing.
      retry: false,
      staleTime: 60_000,
    },
  });

  const { mutate: logout, isPending: isSigningOut } = useLogout();

  const signOut = () => {
    logout(undefined, {
      // Reload rather than clearing in place, so nothing written by the
      // account that just signed out can still be on screen for whoever signs
      // in next — even briefly.
      onSettled: () => reloadToHome(),
    });
  };

  const user = !error && data ? data : null;

  return (
    <SessionContext.Provider value={{ user, isLoading, signOut, isSigningOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);

  if (!value) {
    throw new Error("useSession must be used inside a SessionProvider");
  }

  return value;
}

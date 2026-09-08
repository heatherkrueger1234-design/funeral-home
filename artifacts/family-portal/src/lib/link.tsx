import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

/**
 * The family's credential, and where it lives.
 *
 * The director texts a link ending `/f/<token>`. On first load the token is
 * lifted out of the URL, kept, and the URL is rewritten to `/` so that the
 * token stops being on screen — a phone handed round a kitchen table should
 * not be showing the credential in its address bar, and a screenshot of the
 * portal should not be a working link.
 *
 * It is kept in `localStorage` rather than memory so that closing the tab and
 * coming back tomorrow does not require digging the original text message out
 * again. That is a deliberate trade: the token is already sitting in that
 * text message on the same phone, so storing it here does not meaningfully
 * widen who can reach the case, and it removes the single most likely reason
 * for a family to give up and ring the director instead.
 */

const STORAGE_KEY = "fh.family.token";

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing, or storage disabled entirely. The token from the URL
    // still works for this tab.
    return null;
  }
}

function writeStored(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* Not fatal — see above. */
  }
}

/** The token in `/f/<token>`, if this is a link arrival. */
function tokenFromUrl(): string | null {
  const match = /^\/f\/([^/?#]+)/.exec(window.location.pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

type LinkState = {
  token: string | null;
  /** Forget this device's link — for a shared or borrowed phone. */
  forget: () => void;
};

const LinkContext = createContext<LinkState | null>(null);

export function LinkProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    const fromUrl = tokenFromUrl();

    if (fromUrl) {
      writeStored(fromUrl);
      return fromUrl;
    }

    return readStored();
  });

  // Get the token out of the address bar as soon as React has it.
  useEffect(() => {
    if (tokenFromUrl()) {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  // The generated API client attaches this as `Authorization: Bearer <token>`
  // on every request, including the multipart photo upload.
  useEffect(() => {
    setAuthTokenGetter(() => token);
    return () => setAuthTokenGetter(null);
  }, [token]);

  const value = useMemo<LinkState>(
    () => ({
      token,
      forget: () => {
        writeStored(null);
        setToken(null);
      },
    }),
    [token],
  );

  return <LinkContext.Provider value={value}>{children}</LinkContext.Provider>;
}

export function useLink(): LinkState {
  const value = useContext(LinkContext);
  if (!value) throw new Error("useLink must be used inside a LinkProvider");
  return value;
}

/** A 401 means the link is revoked, expired, or was never real. */
export function isUnauthorized(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 401;
}

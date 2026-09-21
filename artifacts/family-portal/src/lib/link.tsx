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
  if (typeof window === "undefined") return null;

  const match = /^\/f\/([^/?#]+)/.exec(window.location.pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * The link this device is using: the URL's if this is an arrival, else the
 * kept one.
 *
 * Runs at module scope, which is the whole point (see below) and is also the
 * reason `tokenFromUrl` checks for a window first. This is a browser-only
 * app and always will be, but an import that reaches for `window` while the
 * module is still evaluating fails in a way that names neither the file nor
 * the reason — so the one line that makes it a null instead of a crash is
 * worth having before somebody adds the first test that renders a page.
 */
function resolveToken(): string | null {
  const fromUrl = tokenFromUrl();

  if (fromUrl) {
    writeStored(fromUrl);
    return fromUrl;
  }

  return readStored();
}

/*
 * The credential is registered with the API client here, at module scope,
 * and that placement is load-bearing rather than tidy-minded.
 *
 * It used to be registered from an effect inside `LinkProvider`, which is
 * where it looks like it belongs and is a tick too late. React runs a
 * child's effects before its parent's, so the query that `PortalShell`
 * mounts fired *before* the provider above it had installed the getter —
 * and the opening request of every single cold load went out with no
 * `Authorization` header at all. The server did the only correct thing with
 * an unauthenticated request and returned 401.
 *
 * It recovered on the automatic retry, so it looked like nothing worse than
 * a slow first paint. What it actually was: a wasted round trip on every
 * load, on a phone on mobile data; two rate-limiter slots spent to open one
 * page; and — the part that matters — a family one dropped retry away from
 * being told "This link has expired. Please ask the funeral home to send you
 * a new one" about a link that was working perfectly. That sentence is the
 * single most expensive thing this portal can say to someone, and it must
 * never be said because of our own ordering.
 *
 * A module-scope getter cannot lose that race: the bundle has evaluated
 * before React renders anything at all.
 */
let activeToken: string | null = resolveToken();
setAuthTokenGetter(() => activeToken);

type LinkState = {
  token: string | null;
  /** Forget this device's link — for a shared or borrowed phone. */
  forget: () => void;
};

const LinkContext = createContext<LinkState | null>(null);

export function LinkProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(activeToken);

  // Get the token out of the address bar as soon as React has it.
  useEffect(() => {
    if (tokenFromUrl()) {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  const value = useMemo<LinkState>(
    () => ({
      token,
      forget: () => {
        writeStored(null);
        // Cleared before the re-render, not after it, so nothing that is
        // still mounted can fire one last request with a token the family
        // has just asked this device to forget.
        activeToken = null;
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

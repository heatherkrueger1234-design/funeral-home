import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { CookieOptions, Response } from "express";

/**
 * Google sign-in, as the plain server-side authorization-code flow.
 *
 * No SDK. The whole exchange is three HTTPS calls, and doing it directly
 * keeps the session in the same httpOnly cookie as every other sign-in rather
 * than introducing a second, browser-held credential.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

export const OAUTH_STATE_COOKIE = "mh_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/** Null when Google sign-in has not been configured, which is a valid state. */
export function googleConfig(): GoogleConfig | null {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PUBLIC_URL } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return null;
  }

  if (!PUBLIC_URL) {
    throw new Error(
      "PUBLIC_URL must be set when Google sign-in is configured — it is how " +
        "the callback URL is built, and it must match the redirect URI " +
        "registered in the Google Cloud console exactly.",
    );
  }

  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: `${PUBLIC_URL.replace(/\/$/, "")}/api/auth/google/callback`,
  };
}

export function isGoogleConfigured(): boolean {
  return googleConfig() !== null;
}

/* ------------------------------------------------------------------ state */

/**
 * CSRF protection for the redirect. A random value goes out in the URL and
 * into a short-lived cookie; the callback only proceeds when the two match.
 * Without it, an attacker can complete the flow in a victim's browser and
 * leave them signed into the attacker's account.
 */
export function issueState(res: Response): string {
  const state = randomBytes(24).toString("base64url");

  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // must survive the cross-site redirect back from Google
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_MS,
  } satisfies CookieOptions);

  return state;
}

export function stateMatches(fromQuery: unknown, fromCookie: unknown): boolean {
  if (typeof fromQuery !== "string" || typeof fromCookie !== "string") {
    return false;
  }

  const a = createHash("sha256").update(fromQuery).digest();
  const b = createHash("sha256").update(fromCookie).digest();
  return timingSafeEqual(a, b);
}

export function clearState(res: Response): void {
  res.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

/* ------------------------------------------------------------------- flow */

export function authorizationUrl(config: GoogleConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    // Only ever needed once per sign-in; no refresh token is stored.
    access_type: "online",
    prompt: "select_account",
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
};

export class GoogleAuthError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export async function exchangeCode(
  config: GoogleConfig,
  code: string,
): Promise<GoogleProfile> {
  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    throw new GoogleAuthError(
      `Google rejected the authorization code (${tokenResponse.status})`,
      await tokenResponse.text().catch(() => undefined),
    );
  }

  const token = (await tokenResponse.json()) as { access_token?: string };

  if (!token.access_token) {
    throw new GoogleAuthError("Google returned no access token");
  }

  // The userinfo endpoint is used in preference to decoding the id_token,
  // because the token came straight from Google over TLS a moment ago. That
  // makes signature verification redundant here and saves carrying a JWKS
  // cache purely to re-derive what this call returns directly.
  const profileResponse = await fetch(USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });

  if (!profileResponse.ok) {
    throw new GoogleAuthError(
      `Could not read the Google profile (${profileResponse.status})`,
    );
  }

  const profile = (await profileResponse.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  if (!profile.sub || !profile.email) {
    throw new GoogleAuthError("Google profile was missing an id or an email");
  }

  return {
    sub: profile.sub,
    email: profile.email.trim().toLowerCase(),
    emailVerified: profile.email_verified === true,
    name: profile.name ?? null,
  };
}

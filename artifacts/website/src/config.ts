/*
 * Everything the page needs to know about where it is deployed, read once at
 * build time. See vite.config.ts for what each variable does when unset.
 */

const trim = (value: string | undefined) => (value ?? "").trim().replace(/\/+$/, "");

/** The director console's origin, e.g. https://console.holdingtoday.example */
export const consoleUrl = trim(import.meta.env.VITE_CONSOLE_URL);

/*
 * Where "Start a free trial" goes: the console's one front door, opened in
 * its "Set up a new funeral home" mode by `?register` (see SignIn.tsx).
 */
export const trialHref = consoleUrl ? `${consoleUrl}/?register` : "#pricing";
export const signInHref = consoleUrl ? `${consoleUrl}/` : undefined;

export const contactEmail = (import.meta.env.VITE_CONTACT_EMAIL ?? "").trim();
export const contactHref = contactEmail ? `mailto:${contactEmail}` : undefined;

/*
 * OWNER: the terms and the privacy policy live in LEGAL/ as drafts that have
 * not been through a lawyer, and LEGAL/README.md says not to put them in front
 * of a paying customer until they have. Until then these are unset and the
 * footer says the documents are in review and available on request. Once
 * they are final, publish them and set VITE_PRIVACY_URL and VITE_TERMS_URL.
 */
export const privacyHref = trim(import.meta.env.VITE_PRIVACY_URL) || undefined;
export const termsHref = trim(import.meta.env.VITE_TERMS_URL) || undefined;

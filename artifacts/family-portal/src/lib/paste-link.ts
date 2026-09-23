/**
 * Pull the token out of whatever a family pastes into the "paste your link"
 * box, or null if there is nothing that could be one.
 *
 * What arrives here is whatever a phone's copy button produced from a text
 * message or an email: usually the whole link, sometimes with the sentence
 * around it, a trailing full stop, or the address without its `https://`.
 * Now and then a director reads the last part out over the telephone and it
 * is typed in by hand. All of those should work, because the alternative is
 * a family ringing the home to ask why the link "doesn't work".
 *
 * Tokens are 32 random bytes in base64url (see the API's family-link.ts), so
 * a bare token is a run of 43 URL-safe characters. The length floor is lower
 * than that so a future change to the token size does not silently break
 * this box, and high enough that a stray word is not mistaken for a link.
 */
export function tokenFromPasted(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  const inLink = /\/f\/([A-Za-z0-9_-]+)/.exec(text);
  if (inLink?.[1]) return inLink[1];

  if (/^[A-Za-z0-9_-]{20,}$/.test(text)) return text;

  return null;
}

/*
 * What is being written to the funeral home, kept for this tab until it is
 * sent.
 *
 * A long question typed with one thumb is lost in full by a stray tap on
 * "Everything else", and it is rarely typed a second time. Session storage
 * rather than local: a half-written message should not be sitting on a
 * borrowed phone tomorrow.
 *
 * Kept per person, and forgotten with the link. It used to be one key for
 * the whole tab, so on a shared tablet, after one family tapped "Forget it
 * here" and the next pasted their own link, the next family's message box
 * opened holding the first family's words, one tap from sending them to the
 * wrong funeral home. The key is the contact's id, not anything from the
 * link: the token is the credential, and is kept nowhere but where link.tsx
 * keeps it.
 */
const DRAFT_KEY = "fh.family.message-draft";

const keyFor = (contactId: number) => `${DRAFT_KEY}.${contactId}`;

/*
 * `contactId` is undefined only before the session has loaded, and then
 * nothing is kept: a draft with nobody's name on it is the mistake above.
 */
export function readDraft(contactId: number | undefined): string {
  if (contactId === undefined) return "";
  try {
    return window.sessionStorage.getItem(keyFor(contactId)) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(contactId: number | undefined, text: string): void {
  if (contactId === undefined) return;
  try {
    if (text) window.sessionStorage.setItem(keyFor(contactId), text);
    else window.sessionStorage.removeItem(keyFor(contactId));
  } catch {
    /* Storage blocked: the draft simply lives as long as the screen. */
  }
}

/**
 * Every unsent message this tab is keeping, whoever was writing it, including
 * one kept under the single key from before.
 */
export function forgetDrafts(): void {
  try {
    const storage = window.sessionStorage;
    const drafts: string[] = [];
    // Gathered first: removing an item while walking the keys renumbers them.
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(DRAFT_KEY)) drafts.push(key);
    }
    for (const key of drafts) storage.removeItem(key);
  } catch {
    /* Storage blocked: nothing was kept, so there is nothing to forget. */
  }
}

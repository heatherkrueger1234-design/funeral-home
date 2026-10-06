import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetDrafts, readDraft, writeDraft } from "./message-draft";

/**
 * A message half-written on a shared tablet, and whoever picks the tablet up
 * next. Run in node, so the tab's session storage is stood in for.
 */

/** Session storage as a tab holds it: strings, in the order they were set. */
function tabStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, String(value));
    },
    removeItem: (key) => {
      items.delete(key);
    },
    clear: () => items.clear(),
  };
}

const question = "Can we bring Mum's own hymn book on the day?";
let storage: Storage;

beforeEach(() => {
  storage = tabStorage();
  vi.stubGlobal("window", { sessionStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an unsent message", () => {
  it("is still there for the person who was writing it", () => {
    writeDraft(11, question);
    expect(readDraft(11)).toBe(question);
  });

  it("never opens in somebody else's message box on the same tablet", () => {
    // One family's link forgotten, the next family's pasted into the same
    // tab: their box must not arrive holding the first family's words.
    writeDraft(11, question);
    expect(readDraft(22)).toBe("");
  });

  it("goes when the link is forgotten here, with every other one the tab kept", () => {
    writeDraft(11, question);
    writeDraft(22, "What time should we arrive?");
    // A tab open since before drafts were kept per person.
    storage.setItem("fh.family.message-draft", "Do we need to bring clothes?");
    storage.setItem("chunk-reload-at", "1759650000000");

    forgetDrafts();

    expect(readDraft(11)).toBe("");
    expect(readDraft(22)).toBe("");
    expect(storage.getItem("fh.family.message-draft")).toBeNull();
    // Nothing that is not a message is touched.
    expect(storage.getItem("chunk-reload-at")).toBe("1759650000000");
  });

  it("is let go once it has been sent", () => {
    writeDraft(11, question);
    writeDraft(11, "");
    expect(storage.length).toBe(0);
  });

  it("never stops the link being forgotten when the browser refuses storage", () => {
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    expect(() => forgetDrafts()).not.toThrow();
    expect(() => writeDraft(11, question)).not.toThrow();
    expect(readDraft(11)).toBe("");
  });
});

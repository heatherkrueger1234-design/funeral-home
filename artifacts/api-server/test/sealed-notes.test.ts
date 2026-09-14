import { describe, expect, it } from "vitest";
import {
  formatPasscode,
  isWellFormedPasscode,
  mintPasscode,
  normalisePasscode,
  passcodeCard,
  passcodeOpens,
  revealPasscodeForHome,
  seal,
  sealPasscodeForHome,
  sealWith,
  SealedNoteError,
  unseal,
} from "@workspace/db/sealed";
import { decrypt, encrypt } from "@workspace/db/crypto";
import { retryDelayMs, toSealedNoteSummary } from "@workspace/db";

/**
 * The one promise this file exists to keep: a sealed note cannot be read by
 * this company, by the funeral home holding it, or by anybody who takes a
 * copy of the database. Every test below is a way that promise could be
 * broken by a later change.
 */

const LETTER = [
  "Ruth — this is the one I couldn't say out loud, so it is in writing",
  "instead, which is cowardly of me and I am doing it anyway.",
  "Whatever is left after the house sells is yours.",
].join("\n");

describe("passcodes", () => {
  it("is eight characters a person can read down a telephone", () => {
    const code = mintPasscode();
    expect(code).toMatch(/^[0-9A-HJ-KM-NP-TV-Z]{4}-[0-9A-HJ-KM-NP-TV-Z]{4}$/);
    expect(isWellFormedPasscode(code)).toBe(true);
  });

  it("never mints the ambiguous letters", () => {
    // I/L/O/U are the pairs people get wrong reading aloud across a desk.
    const minted = Array.from({ length: 400 }, () => mintPasscode()).join("");
    expect(minted).not.toMatch(/[ILOU]/);
  });

  it("forgives how somebody actually types it", () => {
    const code = mintPasscode();
    const mangled = "  " + code.replace("-", "").toLowerCase() + " ";
    expect(normalisePasscode(mangled)).toBe(normalisePasscode(code));
  });

  it("reads O as zero and I or L as one, the way the alphabet says", () => {
    expect(normalisePasscode("OIL0")).toBe("0110");
  });

  it("is not all one value", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintPasscode()));
    expect(seen.size).toBeGreaterThan(190);
  });
});

describe("sealing", () => {
  it("opens with its own passcode and nothing else", async () => {
    const { passcode, envelope } = await seal(LETTER);
    expect(await unseal(envelope, passcode)).toBe(LETTER);

    await expect(unseal(envelope, mintPasscode())).rejects.toThrow(SealedNoteError);
  });

  it("stores no passcode anywhere in the envelope", async () => {
    const { passcode, envelope } = await seal(LETTER);
    const bare = normalisePasscode(passcode);
    const asJson = JSON.stringify(envelope);

    expect(asJson).not.toContain(bare);
    expect(asJson).not.toContain(passcode);
    expect(Object.keys(envelope).sort()).toEqual(
      ["ciphertext", "iv", "kdf", "salt", "tag", "verifier", "version"],
    );
  });

  it("keeps no plaintext in the envelope either", async () => {
    const { envelope } = await seal(LETTER);
    const asJson = JSON.stringify(envelope);
    expect(asJson).not.toContain("Ruth");
    expect(asJson).not.toContain("house");
  });

  it("gives the same refusal for a wrong passcode and a corrupted row", async () => {
    const { passcode, envelope } = await seal(LETTER);

    const wrong = await unseal(envelope, mintPasscode()).catch((e) => e.message);
    const corrupted = await unseal(
      { ...envelope, verifier: Buffer.alloc(16).toString("base64") },
      passcode,
    ).catch((e) => e.message);

    expect(wrong).toBe(corrupted);
  });

  it("refuses a note whose ciphertext was edited, rather than returning rubbish", async () => {
    const { passcode, envelope } = await seal(LETTER);
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[0] ^= 0xff;

    await expect(
      unseal({ ...envelope, ciphertext: bytes.toString("base64") }, passcode),
    ).rejects.toThrow(SealedNoteError);
  });

  it("seals the same words differently every time", async () => {
    const a = await seal(LETTER);
    const b = await seal(LETTER);
    expect(a.envelope.ciphertext).not.toBe(b.envelope.ciphertext);
    expect(a.envelope.salt).not.toBe(b.envelope.salt);
  });

  it("checks a passcode without producing the note", async () => {
    const { passcode, envelope } = await seal(LETTER);
    expect(await passcodeOpens(envelope, passcode)).toBe(true);
    expect(await passcodeOpens(envelope, mintPasscode())).toBe(false);
    expect(await passcodeOpens(envelope, "not-a-code")).toBe(false);
  });

  it("re-seals under a passcode already on a card, so an edit does not reissue it", async () => {
    const { passcode, envelope } = await seal("first draft");
    const revised = await sealWith("what he meant to say", passcode);

    expect(await unseal(revised, passcode)).toBe("what he meant to say");
    // Same card still works; the old ciphertext is gone.
    expect(revised.ciphertext).not.toBe(envelope.ciphertext);
  });

  it("carries its own scrypt parameters, so they can be raised later", async () => {
    const { envelope } = await seal(LETTER);
    expect(envelope.kdf).toEqual({ N: 16384, r: 8, p: 1 });
  });

  it("refuses a passcode it would never have issued", async () => {
    await expect(sealWith(LETTER, "hunter2")).rejects.toThrow(SealedNoteError);
  });
});

describe("the escrow the planner has to opt into", () => {
  it("lets a director read the passcode out when it is on", async () => {
    const { passcode, envelope } = await seal(LETTER);

    const stored = sealPasscodeForHome(passcode, encrypt);
    expect(stored).not.toContain(normalisePasscode(passcode));

    const revealed = revealPasscodeForHome(stored, decrypt);
    expect(revealed).toBe(formatPasscode(passcode));
    expect(await unseal(envelope, revealed)).toBe(LETTER);
  });

  it("says so in the summary, because the reader deserves to know", () => {
    const base = {
      id: 1, forWhom: "Ruth", relationship: "Daughter", hint: null,
      createdAt: new Date(), cardPrintedAt: null, handedOverAt: null,
      handedOverTo: null, openedAt: null,
    };

    expect(toSealedNoteSummary({ ...base, escrowedPasscode: null } as never).homeCanReveal).toBe(false);
    expect(toSealedNoteSummary({ ...base, escrowedPasscode: "v1.x.y.z" } as never).homeCanReveal).toBe(true);
  });
});

describe("what leaves the server", () => {
  it("never includes the envelope or the escrow", () => {
    const summary = toSealedNoteSummary({
      id: 7, funeralHomeId: 1, caseId: 3,
      forWhom: "Daniel", relationship: "Son", hint: "The dog we had",
      envelope: { version: "s1", ciphertext: "SECRET" },
      escrowedPasscode: "v1.a.b.c",
      cardPrintedAt: null, handedOverAt: null, handedOverTo: null,
      failedAttempts: 0, lastAttemptAt: null, openedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as never);

    const asJson = JSON.stringify(summary);
    expect(asJson).not.toContain("SECRET");
    expect(asJson).not.toContain("v1.a.b.c");
    expect(summary.forWhom).toBe("Daniel");
  });
});

describe("slowing down somebody working through their guesses", () => {
  it("costs nothing for the first mistakes and everything after", () => {
    expect(retryDelayMs(0)).toBe(0);
    expect(retryDelayMs(2)).toBe(0);
    expect(retryDelayMs(3)).toBe(1000);
    expect(retryDelayMs(6)).toBe(8000);
    expect(retryDelayMs(40)).toBe(60_000);
  });
});

describe("the card the director hands over", () => {
  it("names the person, prints the code, and says nobody can reissue it", () => {
    const card = passcodeCard({
      forWhom: "Ruth", fromWhom: "Thomas", homeName: "Cedar Hollow Funeral Home",
      passcode: "K7RM2XQH", hint: "The town we broke down in, 1987",
    });

    expect(card).toContain("FOR RUTH, AND NOBODY ELSE");
    expect(card).toContain("K7RM-2XQH");
    expect(card).toContain("The town we broke down in, 1987");
    expect(card).toContain("cannot");
    expect(card).toContain("no way to issue another one");
  });
});

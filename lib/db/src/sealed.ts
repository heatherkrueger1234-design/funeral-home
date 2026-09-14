import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * Notes a dying person leaves for one named reader, and the passcode that
 * opens each one.
 *
 * The whole file exists to make one sentence true: **a sealed note cannot be
 * read by this company, by the funeral home holding it, or by anybody who
 * takes a copy of the database.** Everything else here follows from that, and
 * the parts that look like friction are the parts that make it true.
 *
 * How it works, in four steps:
 *
 *  1. When the note is written, the server mints a passcode — `K7RM-2XQH`,
 *     forty bits, deliberately short enough to read aloud across a desk.
 *  2. The note is encrypted under a key derived from that passcode with
 *     scrypt, then AES-256-GCM.
 *  3. What is stored is the ciphertext, the salt, the IV, the tag, and a
 *     verifier. **The passcode itself is not stored.** It is returned exactly
 *     once, to be printed on a card, and after that no query can recover it.
 *  4. The reader types the passcode on their own device and the note comes
 *     back. A wrong passcode fails at GCM's tag check, which is the same
 *     answer as a corrupted row, which is the same answer as a guess.
 *
 * Why scrypt and not the app's ordinary key: forty bits is guessable if each
 * guess is cheap, so each guess is made to cost about a tenth of a second and
 * sixteen megabytes. That puts an offline attack on one note in the range of
 * millennia on a single core, and — because scrypt is memory-hard — does not
 * collapse the moment somebody points a graphics card at it. It also means
 * unsealing takes a visible fraction of a second, which is the cost.
 *
 * ## The passcode has to reach one person, and that is a paper problem
 *
 * The mechanism above is the easy half. The hard half is handing the code to
 * the daughter and to nobody else, and no amount of cryptography solves that
 * — it is a custody problem, and funeral homes are already good at custody.
 *
 * So the intended flow, and the one `directorCanReveal: false` supports:
 * the passcode is printed once onto a card at the moment of writing, the card
 * is sealed, and the home keeps it in the file with the signed originals. The
 * director hands the sealed card to the named person when they come in. The
 * director performs the handover without ever learning the code, which is the
 * point — a code the director knows is a code the home can be subpoenaed for,
 * talked out of, or have stolen along with everything else in the office.
 *
 * ## And the escrow, because a home will ask for it
 *
 * Some homes will not run a paper process, and a planner may reasonably
 * decide that a director reading the code off a screen is good enough for
 * what they wrote. `sealPasscodeForHome` covers that: the passcode is *also*
 * kept, encrypted under the home's own key, so a director can read it out.
 *
 * It is off unless the writer turns it on, it is recorded against the note,
 * and the writer is told in one sentence what it costs — because with escrow
 * on, the first sentence of this file stops being true for that note. It then
 * has exactly the security of a password written in the office safe: good
 * against a stranger, useless against anyone with the safe.
 */

/* ------------------------------------------------------------- passcodes -- */

/**
 * Crockford's base32 alphabet, which drops I, L, O and U.
 *
 * Chosen because the failure mode here is not cryptographic, it is a director
 * reading eight characters aloud to a sixty-year-old across a desk, and every
 * excluded character is one of the pairs people get wrong doing exactly that.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PASSCODE_CHARS = 8; // 8 * 5 bits = 40 bits

/**
 * A fresh passcode, grouped for reading aloud: `K7RM-2XQH`.
 *
 * `randomInt` rather than an index into random bytes, because 256 is not a
 * multiple of 32 and the naive version quietly biases the last few letters.
 */
export function mintPasscode(): string {
  let out = "";
  for (let i = 0; i < PASSCODE_CHARS; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out.slice(0, 4) + "-" + out.slice(4);
}

/**
 * What somebody typed, as the passcode it was meant to be.
 *
 * People type the hyphen or they do not, they use lower case, and they paste
 * a trailing space out of a text message. None of those is a wrong passcode.
 * The character folding is Crockford's own: O is zero, I and L are one.
 */
export function normalisePasscode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function isWellFormedPasscode(raw: string): boolean {
  const value = normalisePasscode(raw);
  if (value.length !== PASSCODE_CHARS) return false;
  return [...value].every((c) => ALPHABET.includes(c));
}

/** How it is printed on the card. */
export function formatPasscode(raw: string): string {
  const v = normalisePasscode(raw);
  return v.slice(0, 4) + "-" + v.slice(4);
}

/* --------------------------------------------------------------- sealing -- */

/**
 * OWASP's floor for scrypt, which is also what `auth.ts` uses for passwords.
 * Kept in the stored envelope so these can be raised later without stranding
 * every note already written.
 */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERIFIER_BYTES = 16;
const ALGORITHM = "aes-256-gcm";
const VERSION = "s1";

/**
 * What a sealed note looks like at rest.
 *
 * Deliberately a plain record rather than a blob: every field here is one a
 * human debugging a restored backup will want to see, and none of them is a
 * secret. There is no field for the passcode because there is no passcode
 * field — that is the design, not an omission, and a migration that adds one
 * is a migration that breaks the promise.
 */
export type SealedEnvelope = {
  version: string;
  /** scrypt parameters, so a future raise does not strand old notes. */
  kdf: { N: number; r: number; p: number };
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  /**
   * Lets `unseal` tell "wrong passcode" from "corrupted row" cheaply, and
   * lets a caller check a passcode without decrypting anything. Derived from
   * the same key, so it reveals nothing the ciphertext does not.
   */
  verifier: string;
};

async function deriveKey(
  passcode: string,
  salt: Buffer,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  return scrypt(normalisePasscode(passcode), salt, KEY_BYTES, params);
}

/** The verifier is a separate hash of the key, never the key itself. */
function verifierFor(key: Buffer): Buffer {
  return createHash("sha256").update(key).update("sealed-note-verifier").digest().subarray(0, VERIFIER_BYTES);
}

export class SealedNoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealedNoteError";
  }
}

/**
 * Seal a note under a fresh passcode.
 *
 * Returns the passcode alongside the envelope because this is the only moment
 * it exists. The caller's job is to put it on a card and then forget it; a
 * caller that writes it to a log, an email, a queue or a column has undone
 * the file.
 */
export async function seal(
  plaintext: string,
): Promise<{ passcode: string; envelope: SealedEnvelope }> {
  const passcode = mintPasscode();
  return { passcode, envelope: await sealWith(plaintext, passcode) };
}

/** Seal under a passcode the caller already has — used when a note is edited. */
export async function sealWith(
  plaintext: string,
  passcode: string,
): Promise<SealedEnvelope> {
  if (!isWellFormedPasscode(passcode)) {
    throw new SealedNoteError("That is not a passcode this system issues.");
  }

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(passcode, salt, SCRYPT_PARAMS);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    version: VERSION,
    kdf: { ...SCRYPT_PARAMS },
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    verifier: verifierFor(key).toString("base64"),
  };
}

/**
 * Open a sealed note, or refuse.
 *
 * Every refusal is the same refusal. A reader who mistyped, a reader guessing,
 * and a restored backup with a corrupted row all get one sentence, because the
 * alternative tells somebody standing in a funeral home with a stolen card
 * which of the three they are looking at.
 */
export async function unseal(
  envelope: SealedEnvelope,
  passcode: string,
): Promise<string> {
  if (envelope.version !== VERSION) {
    throw new SealedNoteError("This note was written by a version we cannot read.");
  }
  if (!isWellFormedPasscode(passcode)) {
    throw new SealedNoteError("That passcode is not right.");
  }

  const salt = Buffer.from(envelope.salt, "base64");
  const key = await deriveKey(passcode, salt, envelope.kdf ?? SCRYPT_PARAMS);

  const expected = Buffer.from(envelope.verifier, "base64");
  const actual = verifierFor(key);

  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    throw new SealedNoteError("That passcode is not right.");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SealedNoteError("That passcode is not right.");
  }
}

/** Whether a passcode opens a note, without producing the note. */
export async function passcodeOpens(
  envelope: SealedEnvelope,
  passcode: string,
): Promise<boolean> {
  if (!isWellFormedPasscode(passcode)) return false;
  const key = await deriveKey(passcode, Buffer.from(envelope.salt, "base64"), envelope.kdf ?? SCRYPT_PARAMS);
  const expected = Buffer.from(envelope.verifier, "base64");
  const actual = verifierFor(key);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/* ----------------------------------------------------------- the escrow -- */

/**
 * Keep the passcode where a director can read it out.
 *
 * Off by default and never turned on by this software's own judgement: it is
 * the writer's decision, made once per note, with the cost in front of them.
 * With this on, a note is exactly as private as the funeral home's own
 * database — which is a reasonable thing to choose for "the fishing rod is
 * yours" and a bad thing to choose for the letter people actually write.
 *
 * The passcode is encrypted under the application key rather than stored as
 * text, so it is at least not sitting in a dump in the clear; but this is a
 * smaller claim than the one at the top of the file and must not be described
 * to a planner as the same thing.
 *
 * Takes the app's own `encrypt`/`decrypt` as arguments rather than importing
 * them, so that nothing in this file can quietly gain access to the key it
 * spends the rest of its length not having.
 */
export function sealPasscodeForHome(
  passcode: string,
  encrypt: (plain: string) => string,
): string {
  return encrypt(normalisePasscode(passcode));
}

export function revealPasscodeForHome(
  stored: string,
  decrypt: (cipher: string) => string,
): string {
  return formatPasscode(decrypt(stored));
}

/* ------------------------------------------------------------ the card --- */

/**
 * What gets printed, sealed, and put in the file.
 *
 * Plain text on purpose. It is photocopied, folded into an envelope, and read
 * by somebody upset in a car park, and every one of those is a reason not to
 * make it a design exercise. The recipient's name is on it because the whole
 * mechanism fails if the wrong envelope is handed over.
 */
export function passcodeCard(options: {
  forWhom: string;
  fromWhom: string;
  homeName: string;
  passcode: string;
  hint?: string | null;
}): string {
  const lines = [
    `FOR ${options.forWhom.toUpperCase()}, AND NOBODY ELSE`,
    "",
    `${options.fromWhom} left you something to read.`,
    "",
    `The passcode is:   ${formatPasscode(options.passcode)}`,
    "",
  ];

  if (options.hint) lines.push(`They said to tell you: ${options.hint}`, "");

  lines.push(
    "Type it where the website asks. It is not case sensitive and the dash",
    "does not matter.",
    "",
    `${options.homeName} has not read what ${options.fromWhom} wrote and cannot`,
    "open it. Neither can the company that makes this software. That is the",
    "point of it.",
    "",
    "Keep this card. There is no way to issue another one, and nobody to ask.",
  );

  return lines.join("\n") + "\n";
}

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Encryption at rest for the few columns that hold things a stolen database
 * backup must not reveal: the documents table carries medical records,
 * autopsy reports and — per the app's own placeholder text — passwords.
 *
 * What this protects against, honestly stated: a leaked dump, a snapshot of a
 * decommissioned disk, an over-broad read replica, a support engineer with
 * table access. It does *not* protect against someone who has compromised the
 * running application server, because that process must hold the key in order
 * to show the data to its owner. Defending against that requires deriving a
 * key from the user's password and giving up server-side recovery entirely —
 * a real design choice with a real cost (forget the password, lose the data),
 * and not one to make silently on someone's behalf.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const TAG_BYTES = 16;
const PREFIX = "v1";

let cachedKey: Buffer | null = null;

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      "ENCRYPTION_KEY is not set. Records containing passwords and medical " +
        "documents cannot be stored safely without it.\n" +
        "Generate one with:\n" +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"\n" +
        "then set it as a secret named ENCRYPTION_KEY. Keep a copy somewhere " +
        "safe: without this exact value the encrypted records cannot be read back.",
    );
    this.name = "MissingEncryptionKeyError";
  }
}

export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.ENCRYPTION_KEY;

  if (!raw) {
    throw new MissingEncryptionKeyError();
  }

  const key = Buffer.from(raw, "base64");

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        "It should be base64 of 32 random bytes.",
    );
  }

  cachedKey = key;
  return key;
}

/** Throws at startup rather than at the first save, so misconfiguration is loud. */
export function assertEncryptionConfigured(): void {
  getEncryptionKey();
}

/** Raised when stored ciphertext will not authenticate — corruption, or the
 * wrong key. Distinguishable so a caller can degrade one row rather than
 * failing a whole page. */
export class DecryptionError extends Error {
  constructor(cause?: unknown) {
    super(
      "Stored value could not be decrypted. It may be corrupted, or " +
        "ENCRYPTION_KEY may not be the key it was written with.",
    );
    this.name = "DecryptionError";
    this.cause = cause;
  }
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(`${PREFIX}.`);
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/**
 * Values written before encryption was introduced are returned unchanged, so
 * an existing database keeps reading correctly while
 * `scripts/src/encrypt-existing-documents.ts` catches up.
 */
export function decrypt(stored: string): string {
  if (!isEncrypted(stored)) {
    return stored;
  }

  const [, rawIv, rawTag, rawCiphertext] = stored.split(".");

  if (!rawIv || !rawTag || !rawCiphertext) {
    throw new DecryptionError(new Error("Value is not in the expected form"));
  }

  // Every failure below is the same thing from the reader's point of view —
  // this value cannot be turned back into text — so they all raise
  // DecryptionError. A caller degrading one row must not have to know which
  // of them tripped, and a malformed value must not escape as a bare Error
  // and take down a page that a corrupted one would have survived.
  try {
    const tag = Buffer.from(rawTag, "base64");

    if (tag.length !== TAG_BYTES) {
      throw new Error("Authentication tag is the wrong length");
    }

    const iv = Buffer.from(rawIv, "base64");

    if (iv.length !== IV_BYTES) {
      throw new Error("Initialisation vector is the wrong length");
    }

    const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(tag);

    // GCM verifies the tag in `final()`, so tampering throws rather than
    // returning plausible-looking garbage.
    return Buffer.concat([
      decipher.update(Buffer.from(rawCiphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (cause) {
    if (cause instanceof MissingEncryptionKeyError) throw cause;
    throw new DecryptionError(cause);
  }
}

/**
 * Binary variants for uploaded files. Same key, same algorithm; the layout is
 * packed rather than dotted base64 because these values are bytes on the way
 * in and bytes on the way out, and base64 would inflate every photograph by a
 * third for no benefit.
 *
 * Layout: [1 byte version][12 byte iv][16 byte tag][ciphertext]
 */
const BINARY_VERSION = 1;

export function encryptBuffer(plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return Buffer.concat([
    Buffer.from([BINARY_VERSION]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

export function decryptBuffer(stored: Buffer): Buffer {
  if (stored.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new DecryptionError();
  }

  if (stored[0] !== BINARY_VERSION) {
    throw new DecryptionError(
      new Error(`Unknown payload version ${stored[0]}`),
    );
  }

  const iv = stored.subarray(1, 1 + IV_BYTES);
  const tag = stored.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = stored.subarray(1 + IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (cause) {
    throw new DecryptionError(cause);
  }
}

/** Null-tolerant wrappers, since these columns are all nullable. */
export const encryptNullable = (value: string | null | undefined): string | null =>
  value == null || value === "" ? null : encrypt(value);

export const decryptNullable = (value: string | null | undefined): string | null =>
  value == null ? null : decrypt(value);

/** Exported for tests: proves two encryptions of the same input differ. */
export function constantTimeEquals(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Encrypt and decrypt whole files with the deployment's ENCRYPTION_KEY, for
 * backup dumps rather than the individual columns `@workspace/db/crypto`
 * covers.
 *
 * A pg_dump is mostly plaintext SQL: only the columns already encrypted at
 * the application layer (SSNs, uploaded file bytes) come out as ciphertext.
 * Everything else — decedent and family names, addresses, phone numbers,
 * vital statistics, message bodies — is readable by anyone who gets hold of
 * the dump file, which is the whole point of a backup existing somewhere
 * other than this host. This wraps the file itself in the same AES-256-GCM
 * this app already trusts for that reason, using streams throughout so a
 * multi-gigabyte dump is never held in memory twice.
 *
 * Layout, chosen to match `@workspace/db/crypto`'s `encryptBuffer`:
 * [1 byte version][12 byte iv][16 byte tag][ciphertext...]. The header is
 * fixed-size but known in full only once the whole file has been written —
 * GCM's tag is a function of the entire ciphertext — so encryption streams
 * the ciphertext starting at the header's offset first, then goes back and
 * fills the header in with a second, separate write, rather than buffering
 * the dump in memory to compute the tag up front.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { getEncryptionKey } from "@workspace/db/crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 1;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

export class BackupDecryptionError extends Error {
  constructor(cause?: unknown) {
    super(
      "Backup file could not be decrypted. It may be corrupted, truncated, " +
        "or ENCRYPTION_KEY may not be the key it was written with.",
      { cause },
    );
    this.name = "BackupDecryptionError";
  }
}

/**
 * Encrypt `inputPath` into `outputPath`, then remove `inputPath`.
 *
 * Writes to `outputPath` directly — the caller is responsible for the
 * write-to-a-partial-name-then-rename pattern used elsewhere in these
 * scripts, the same way it already is for the plaintext dump.
 */
export async function encryptFile(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  try {
    // Ciphertext first, through its own stream with its own fd — writing the
    // header needs a second, independent open() afterward anyway, since the
    // tag isn't known until the pipeline below finishes. (A single fd kept
    // open across both steps sounds tidier, but a write stream created from
    // a shared FileHandle with autoClose disabled leaves that handle's
    // close() hanging forever: closing it waits on the stream, which isn't
    // the one being told to end.)
    await pipeline(
      createReadStream(inputPath),
      cipher,
      createWriteStream(outputPath, { start: HEADER_BYTES }),
    );

    const header = Buffer.concat([
      Buffer.from([VERSION]),
      iv,
      cipher.getAuthTag(),
    ]);
    const handle = await open(outputPath, "r+");
    try {
      await handle.write(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }
  } catch (cause) {
    // Leave the plaintext input alone on failure — it's the only copy of
    // this backup until encryption actually succeeds. Only the half-written
    // output is this function's to clean up.
    await rm(outputPath, { force: true });
    throw cause;
  }

  await rm(inputPath);
}

/**
 * Decrypt `inputPath` (as written by `encryptFile`) into `outputPath`.
 *
 * Verifies the GCM tag before anything downstream ever sees the plaintext:
 * the whole ciphertext is decrypted to `outputPath` and only returned to the
 * caller once that succeeds, rather than streaming plaintext into `psql` as
 * it's produced. A restore has to know the dump is genuine before it starts
 * running SQL from it, not partway through.
 */
export async function decryptFile(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const { size } = await stat(inputPath);

  if (size < HEADER_BYTES) {
    throw new BackupDecryptionError(
      new Error("File is too short to be an encrypted backup."),
    );
  }

  const handle = await open(inputPath, "r");
  let header: Buffer;
  try {
    header = Buffer.alloc(HEADER_BYTES);
    await handle.read(header, 0, HEADER_BYTES, 0);
  } finally {
    await handle.close();
  }

  const version = header[0];
  if (version !== VERSION) {
    throw new BackupDecryptionError(
      new Error(`Unknown payload version ${version}`),
    );
  }

  const iv = header.subarray(1, 1 + IV_BYTES);
  const tag = header.subarray(1 + IV_BYTES, HEADER_BYTES);

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(tag);

  const ciphertext = createReadStream(inputPath, {
    start: HEADER_BYTES,
    end: size - 1,
  });

  try {
    await pipeline(ciphertext, decipher, createWriteStream(outputPath));
  } catch (cause) {
    await rm(outputPath, { force: true });
    throw new BackupDecryptionError(cause);
  }
}

/** True for a file this module produced, going only by its extension. */
export function isEncryptedBackupName(name: string): boolean {
  return name.endsWith(".sql.enc");
}

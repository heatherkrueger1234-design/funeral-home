/**
 * Whether the encrypted columns of a restored database open with this key.
 *
 * A restore that brings every row back has proved the rows are there, not
 * that anybody can read them. Every uploaded file and every social security
 * number is AES-256-GCM under ENCRYPTION_KEY (lib/db/src/crypto.ts), so a
 * backup of photographs written under some other key -- the key was changed
 * since, which re-encrypts nothing -- restores cleanly, matches every count,
 * and holds nothing that will ever open again. GCM refuses a single altered
 * byte, so a value that decrypts also came back whole.
 *
 * The oldest and the newest of each, rather than one: the newest proves the
 * key that is writing now, the oldest that what was written first still
 * opens with it. Decrypting every photograph would take as long as there are
 * photographs, and a wrong key fails on the first.
 */
import type pg from "pg";
import {
  decrypt,
  decryptBuffer,
  MissingEncryptionKeyError,
} from "@workspace/db/crypto";

export type Sealed = {
  uploads: { id: number; data: Buffer }[];
  ssns: { id: number; value: string }[];
};

export async function sealedSamples(client: pg.ClientBase): Promise<Sealed> {
  const { rows: uploads } = await client.query<{ id: number; data: Buffer }>(
    `select id, data from uploads
      where id in ((select min(id) from uploads), (select max(id) from uploads))
      order by id`,
  );
  // Only ciphertext: a number stored before encryption was introduced is
  // returned by decrypt() unchanged, which would prove nothing about the key.
  const { rows: ssns } = await client.query<{ id: number; value: string }>(
    `select id, social_security_number as value from vital_statistics
      where id in (
        (select min(id) from vital_statistics where social_security_number like 'v1.%'),
        (select max(id) from vital_statistics where social_security_number like 'v1.%'))
      order by id`,
  );
  return { uploads, ssns };
}

export class SealedValueError extends Error {
  constructor(what: string, cause: unknown) {
    super(
      `${what} in the restored database does not decrypt with this ENCRYPTION_KEY. ` +
        "Either this is not the key it was written with, and nothing else written " +
        "under that key will open from this backup either, or its bytes came back " +
        "damaged. Treat this backup as unreadable until you know which.",
      { cause },
    );
    this.name = "SealedValueError";
  }
}

/**
 * Decrypt each sample, and say what opened. Throws at the first that does
 * not, naming its row and never its contents.
 */
export function openSealed(sealed: Sealed): string[] {
  const attempt = (what: string, open: () => unknown) => {
    try {
      open();
    } catch (cause) {
      if (cause instanceof MissingEncryptionKeyError) throw cause;
      throw new SealedValueError(what, cause);
    }
    return what;
  };

  return [
    ...sealed.uploads.map(({ id, data }) =>
      attempt(`upload ${id}`, () => decryptBuffer(data)),
    ),
    ...sealed.ssns.map(({ id, value }) =>
      attempt(`the social security number on vital_statistics ${id}`, () =>
        decrypt(value),
      ),
    ),
  ];
}

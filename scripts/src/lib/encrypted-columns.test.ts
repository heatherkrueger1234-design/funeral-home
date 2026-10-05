import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { encrypt, encryptBuffer } from "@workspace/db/crypto";
import { openSealed, SealedValueError } from "./encrypted-columns";

// The fixed key CI uses (.github/workflows/*.yml); never a deployed secret.
// Read when first needed, so setting it here is in time.
process.env.ENCRYPTION_KEY ??= "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";

/** What the app writes, but under a key that is not this deployment's. */
function sealedUnderAnotherKey(plaintext: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", randomBytes(32), iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    bytes: Buffer.concat([Buffer.from([1]), iv, tag, body]),
    text: ["v1", iv.toString("base64"), tag.toString("base64"), body.toString("base64")].join("."),
  };
}

const PHOTO = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), randomBytes(4096)]);

test("opens what this key wrote, and says which rows it tried", () => {
  const opened = openSealed({
    uploads: [
      { id: 1, data: encryptBuffer(PHOTO) },
      { id: 340, data: encryptBuffer(PHOTO) },
    ],
    ssns: [{ id: 3, value: encrypt("123456789") }],
  });
  assert.deepEqual(opened, [
    "upload 1",
    "upload 340",
    "the social security number on vital_statistics 3",
  ]);
});

test("has nothing to try in a database with no photographs or numbers", () => {
  assert.deepEqual(openSealed({ uploads: [], ssns: [] }), []);
});

test("refuses a photograph written under another key, naming the row", () => {
  assert.throws(
    () =>
      openSealed({
        uploads: [
          { id: 1, data: encryptBuffer(PHOTO) },
          { id: 2, data: sealedUnderAnotherKey(PHOTO).bytes },
        ],
        ssns: [],
      }),
    (error: unknown) =>
      error instanceof SealedValueError &&
      /^upload 2 in the restored database does not decrypt with this ENCRYPTION_KEY/.test(
        error.message,
      ),
  );
});

test("refuses a number written under another key, and never says the number", () => {
  assert.throws(
    () =>
      openSealed({
        uploads: [],
        ssns: [{ id: 4, value: sealedUnderAnotherKey(Buffer.from("123456789")).text }],
      }),
    (error: unknown) =>
      error instanceof SealedValueError &&
      error.message.includes("vital_statistics 4") &&
      !error.message.includes("123456789"),
  );
});

test("refuses a photograph with one byte changed", () => {
  const damaged = encryptBuffer(PHOTO);
  damaged[damaged.length - 1] ^= 0x01;
  assert.throws(
    () => openSealed({ uploads: [{ id: 7, data: damaged }], ssns: [] }),
    /upload 7 in the restored database/,
  );
});

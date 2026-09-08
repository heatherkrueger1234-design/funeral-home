import request from "supertest";
import { describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, uploadsTable } from "@workspace/db";
import { app, closeDatabase, signUp, useCleanDatabase } from "./helpers";

afterAll(closeDatabase);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

describe("uploads", () => {
  useCleanDatabase();

  it("accepts a photograph and gives it back unchanged", async () => {
    const account = await signUp();

    const created = await request(app)
      .post("/api/uploads")
      .set("Cookie", account.cookie)
      .attach("file", PNG, "her-birthday.png")
      .expect(201);

    expect(created.body.mimeType).toBe("image/png");
    expect(created.body.url).toBe(`/api/uploads/${created.body.id}`);

    const fetched = await request(app)
      .get(created.body.url)
      .set("Cookie", account.cookie)
      .expect(200);

    expect(Buffer.from(fetched.body)).toEqual(PNG);
    expect(fetched.headers["content-type"]).toContain("image/png");
    expect(fetched.headers["cache-control"]).toContain("private");
    expect(fetched.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("stores the bytes encrypted", async () => {
    const account = await signUp();

    const created = await request(app)
      .post("/api/uploads")
      .set("Cookie", account.cookie)
      .attach("file", PNG, "photo.png")
      .expect(201);

    const [row] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, created.body.id));

    // A stored PNG would begin with the PNG signature; ciphertext does not.
    expect(row.data.subarray(0, 8).equals(PNG.subarray(0, 8))).toBe(false);
    expect(row.data.includes(PNG)).toBe(false);
  });

  it("accepts a PDF, for scanned records", async () => {
    const account = await signUp();

    const created = await request(app)
      .post("/api/uploads")
      .set("Cookie", account.cookie)
      .attach("file", PDF, "death-certificate.pdf")
      .expect(201);

    expect(created.body.mimeType).toBe("application/pdf");
  });

  it("judges the file by its bytes, not the name or the declared type", async () => {
    const account = await signUp();

    // HTML wearing a .png extension, offered as an image.
    await request(app)
      .post("/api/uploads")
      .set("Cookie", account.cookie)
      .attach("file", Buffer.from("<html><script>alert(1)</script></html>"), {
        filename: "innocent.png",
        contentType: "image/png",
      })
      .expect(400);
  });

  it("refuses SVG, which is a script-bearing document", async () => {
    const account = await signUp();

    await request(app)
      .post("/api/uploads")
      .set("Cookie", account.cookie)
      .attach("file", Buffer.from('<svg onload="alert(1)"></svg>'), {
        filename: "drawing.svg",
        contentType: "image/svg+xml",
      })
      .expect(400);
  });

  it("names the stored file after the type it actually is", async () => {
    const account = await signUp();

    const created = await request(app)
      .post("/api/uploads")
      .set("Cookie", account.cookie)
      .attach("file", PNG, "photo.jpg")
      .expect(201);

    expect(created.body.filename).toBe("photo.png");
  });

  it("strips path traversal out of the filename", async () => {
    const account = await signUp();

    const created = await request(app)
      .post("/api/uploads")
      .set("Cookie", account.cookie)
      .attach("file", PNG, "../../etc/passwd.png")
      .expect(201);

    expect(created.body.filename).not.toContain("..");
    expect(created.body.filename).not.toContain("/");
  });

  it("rejects a file over the size limit", async () => {
    const account = await signUp();
    const oversized = Buffer.concat([PNG, Buffer.alloc(16 * 1024 * 1024)]);

    await request(app)
      .post("/api/uploads")
      .set("Cookie", account.cookie)
      .attach("file", oversized, "huge.png")
      .expect(413);
  });

  it("keeps one account's files away from another", async () => {
    const alice = await signUp();
    const bob = await signUp();

    const created = await request(app)
      .post("/api/uploads")
      .set("Cookie", alice.cookie)
      .attach("file", PNG, "private.png")
      .expect(201);

    await request(app)
      .get(created.body.url)
      .set("Cookie", bob.cookie)
      .expect(404);

    await request(app)
      .delete(created.body.url)
      .set("Cookie", bob.cookie)
      .expect(404);

    await request(app).get(created.body.url).expect(401);

    // Still there and still Alice's.
    await request(app)
      .get(created.body.url)
      .set("Cookie", alice.cookie)
      .expect(200);
  });

  it("removes files when the account is deleted", async () => {
    const account = await signUp();

    await request(app)
      .post("/api/uploads")
      .set("Cookie", account.cookie)
      .attach("file", PNG, "photo.png")
      .expect(201);

    await request(app)
      .delete("/api/auth/account")
      .set("Cookie", account.cookie)
      .send({ password: "a-long-enough-passphrase" })
      .expect(204);

    const remaining = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.userId, account.id));

    expect(remaining).toHaveLength(0);
  });
});

describe("the per-account storage cap", () => {
  useCleanDatabase();

  const withCap = async (bytes: number, run: () => Promise<void>) => {
    const previous = process.env.MAX_ACCOUNT_STORAGE_BYTES;
    process.env.MAX_ACCOUNT_STORAGE_BYTES = String(bytes);
    try {
      await run();
    } finally {
      if (previous === undefined) delete process.env.MAX_ACCOUNT_STORAGE_BYTES;
      else process.env.MAX_ACCOUNT_STORAGE_BYTES = previous;
    }
  };

  it("refuses an upload that would exceed the account's space", async () => {
    const account = await signUp();

    await withCap(PNG.length + 10, async () => {
      // The first fits.
      await request(app)
        .post("/api/uploads")
        .set("Cookie", account.cookie)
        .attach("file", PNG, "one.png")
        .expect(201);

      // The second does not, and says so in words rather than a 500.
      const refused = await request(app)
        .post("/api/uploads")
        .set("Cookie", account.cookie)
        .attach("file", PNG, "two.png")
        .expect(413);

      expect(refused.body.error).toMatch(/space/i);
    });
  });

  it("counts each account separately", async () => {
    const alice = await signUp();
    const bob = await signUp();

    await withCap(PNG.length + 10, async () => {
      await request(app)
        .post("/api/uploads")
        .set("Cookie", alice.cookie)
        .attach("file", PNG, "hers.png")
        .expect(201);

      // Alice being full must not stop Bob.
      await request(app)
        .post("/api/uploads")
        .set("Cookie", bob.cookie)
        .attach("file", PNG, "his.png")
        .expect(201);
    });
  });

  it("frees the space again when a file is removed", async () => {
    const account = await signUp();

    await withCap(PNG.length + 10, async () => {
      const first = await request(app)
        .post("/api/uploads")
        .set("Cookie", account.cookie)
        .attach("file", PNG, "one.png")
        .expect(201);

      await request(app)
        .delete(first.body.url)
        .set("Cookie", account.cookie)
        .expect(204);

      await request(app)
        .post("/api/uploads")
        .set("Cookie", account.cookie)
        .attach("file", PNG, "two.png")
        .expect(201);
    });
  });

  it("reports usage, scoped to the account asking", async () => {
    const alice = await signUp();
    const bob = await signUp();

    await request(app)
      .post("/api/uploads")
      .set("Cookie", alice.cookie)
      .attach("file", PNG, "photo.png")
      .expect(201);

    const hers = await request(app)
      .get("/api/uploads/usage")
      .set("Cookie", alice.cookie)
      .expect(200);
    const his = await request(app)
      .get("/api/uploads/usage")
      .set("Cookie", bob.cookie)
      .expect(200);

    expect(hers.body.usedBytes).toBe(PNG.length);
    expect(his.body.usedBytes).toBe(0);
    expect(hers.body.limitBytes).toBeGreaterThan(0);
  });

  it("does not treat 'usage' as a file id", async () => {
    const account = await signUp();
    // Route order matters: /uploads/usage must win over /uploads/:id.
    await request(app)
      .get("/api/uploads/usage")
      .set("Cookie", account.cookie)
      .expect(200);
  });

  it("needs a session to report usage", async () => {
    await request(app).get("/api/uploads/usage").expect(401);
  });
});

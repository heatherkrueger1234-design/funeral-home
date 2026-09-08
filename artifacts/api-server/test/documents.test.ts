import request from "supertest";
import { describe, expect, it, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, documentsTable } from "@workspace/db";
import { decrypt, encrypt, isEncrypted } from "@workspace/db/crypto";
import { app, closeDatabase, signUp, useCleanDatabase } from "./helpers";

afterAll(closeDatabase);

describe("encryption at rest", () => {
  useCleanDatabase();

  it("writes ciphertext to the database, not the words themselves", async () => {
    const account = await signUp();
    const secret = "tablet passcode 4417";

    const created = await request(app)
      .post("/api/documents")
      .set("Cookie", account.cookie)
      .send({ title: "Her tablet", category: "passwords", content: secret })
      .expect(201);

    const [row] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, created.body.id));

    expect(row.content).not.toBe(secret);
    expect(row.content).not.toContain("4417");
    expect(isEncrypted(row.content!)).toBe(true);
    expect(decrypt(row.content!)).toBe(secret);
  });

  it("gives the same plaintext back through the API", async () => {
    const account = await signUp();

    const created = await request(app)
      .post("/api/documents")
      .set("Cookie", account.cookie)
      .send({
        title: "Autopsy",
        category: "autopsy",
        content: "line one\nline two",
        notes: "difficult reading",
        isPrivate: false,
      })
      .expect(201);

    expect(created.body.content).toBe("line one\nline two");
    expect(created.body.notes).toBe("difficult reading");

    const fetched = await request(app)
      .get(`/api/documents/${created.body.id}`)
      .set("Cookie", account.cookie)
      .expect(200);

    expect(fetched.body.content).toBe("line one\nline two");
  });

  it("encrypts the same text differently every time", () => {
    const first = encrypt("same input");
    const second = encrypt("same input");

    expect(first).not.toBe(second);
    expect(decrypt(first)).toBe("same input");
    expect(decrypt(second)).toBe("same input");
  });

  it("reads back rows written before encryption existed", () => {
    // decrypt() passes plaintext through, so an un-migrated database keeps
    // working until the migration script catches up.
    expect(decrypt("written in the clear")).toBe("written in the clear");
  });
});

describe("privacy of document bodies", () => {
  useCleanDatabase();

  it("withholds a private body from the list and reveals it by id", async () => {
    const account = await signUp();

    const created = await request(app)
      .post("/api/documents")
      .set("Cookie", account.cookie)
      .send({
        title: "Her tablet",
        category: "passwords",
        content: "passcode 4417",
        isPrivate: true,
      })
      .expect(201);

    const list = await request(app)
      .get("/api/documents")
      .set("Cookie", account.cookie)
      .expect(200);

    expect(list.body[0].contentHidden).toBe(true);
    expect(list.body[0].content).toBeNull();
    expect(JSON.stringify(list.body)).not.toContain("4417");

    const single = await request(app)
      .get(`/api/documents/${created.body.id}`)
      .set("Cookie", account.cookie)
      .expect(200);

    expect(single.body.content).toBe("passcode 4417");
  });

  it("shows a non-private body in the list", async () => {
    const account = await signUp();

    await request(app)
      .post("/api/documents")
      .set("Cookie", account.cookie)
      .send({
        title: "Funeral home",
        category: "funeral",
        content: "Riverside Chapel",
        isPrivate: false,
      })
      .expect(201);

    const list = await request(app)
      .get("/api/documents")
      .set("Cookie", account.cookie)
      .expect(200);

    expect(list.body[0].contentHidden).toBe(false);
    expect(list.body[0].content).toBe("Riverside Chapel");
  });

  it("defaults to private when the caller says nothing", async () => {
    const account = await signUp();

    const created = await request(app)
      .post("/api/documents")
      .set("Cookie", account.cookie)
      .send({ title: "Something", category: "other", content: "detail" })
      .expect(201);

    expect(created.body.isPrivate).toBe(true);
  });

  it("does not blank stored content when an update omits it", async () => {
    const account = await signUp();

    const created = await request(app)
      .post("/api/documents")
      .set("Cookie", account.cookie)
      .send({ title: "Records", category: "medical", content: "keep me" })
      .expect(201);

    await request(app)
      .put(`/api/documents/${created.body.id}`)
      .set("Cookie", account.cookie)
      .send({ title: "Renamed" })
      .expect(200);

    const fetched = await request(app)
      .get(`/api/documents/${created.body.id}`)
      .set("Cookie", account.cookie)
      .expect(200);

    expect(fetched.body.title).toBe("Renamed");
    expect(fetched.body.content).toBe("keep me");
  });
});

describe("when stored ciphertext will not authenticate", () => {
  useCleanDatabase();

  it("reports the row unreadable instead of failing the whole page", async () => {
    const account = await signUp();

    const good = await request(app)
      .post("/api/documents")
      .set("Cookie", account.cookie)
      .send({ title: "Intact", category: "other", content: "fine", isPrivate: false })
      .expect(201);

    const damaged = await request(app)
      .post("/api/documents")
      .set("Cookie", account.cookie)
      .send({ title: "Damaged", category: "other", content: "lost", isPrivate: false })
      .expect(201);

    // Corrupt one byte of the ciphertext segment, as a bad restore might.
    await db.execute(sql`
      UPDATE documents
         SET content = split_part(content, '.', 1) || '.' ||
                       split_part(content, '.', 2) || '.' ||
                       split_part(content, '.', 3) || '.' ||
                       (CASE WHEN substr(split_part(content, '.', 4), 1, 1) = 'X'
                             THEN 'Y' ELSE 'X' END) ||
                       substr(split_part(content, '.', 4), 2)
       WHERE id = ${damaged.body.id}
    `);

    const list = await request(app)
      .get("/api/documents")
      .set("Cookie", account.cookie)
      .expect(200);

    const byTitle = Object.fromEntries(
      list.body.map((row: { title: string }) => [row.title, row]),
    );

    expect(byTitle.Intact.content).toBe("fine");
    expect(byTitle.Damaged.contentUnreadable).toBe(true);
    expect(byTitle.Damaged.content).toBeNull();
  });

  it("still lets the account export everything else", async () => {
    const account = await signUp();

    await request(app)
      .post("/api/documents")
      .set("Cookie", account.cookie)
      .send({ title: "Damaged", category: "other", content: "lost" })
      .expect(201);

    await db.execute(sql`UPDATE documents SET content = 'v1.aaaa.bbbb.cccc'`);

    const exported = await request(app)
      .get("/api/auth/export")
      .set("Cookie", account.cookie)
      .expect(200);

    expect(exported.body.data.documents[0].contentUnreadable).toBe(true);
  });
});

import request from "supertest";
import { describe, expect, it, afterAll } from "vitest";
import { app, closeDatabase, signUp, useCleanDatabase } from "./helpers";
import { ZipWriter } from "../src/lib/zip";

/**
 * The archive export exists because the JSON one lists photographs as URLs
 * that only resolve while signed in — which is useless in the situation people
 * actually take an export. These cases assert the bytes are really in there.
 */

afterAll(closeDatabase);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * A deliberately small zip reader: walks the central directory and returns the
 * stored entries. Only understands what ZipWriter emits (stored, no ZIP64),
 * which is exactly the point — it fails if the writer starts emitting
 * something else.
 */
function readZip(buffer: Buffer): Map<string, Buffer> {
  const END_SIG = 0x06054b50;
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== END_SIG) end--;
  if (end < 0) throw new Error("No end-of-central-directory record.");

  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Bad central directory header.");
    }
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;

    files.set(name, buffer.subarray(start, start + size));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

describe("ZipWriter", () => {
  it("strips path traversal out of entry names", () => {
    expect(ZipWriter.safeName("../../etc/passwd")).toBe("etc/passwd");
    expect(ZipWriter.safeName("..\\..\\windows\\system32")).toBe(
      "windows/system32",
    );
    expect(ZipWriter.safeName("/absolute/path.jpg")).toBe("absolute/path.jpg");
    expect(ZipWriter.safeName("./././")).toBe("file");
    expect(ZipWriter.safeName("")).toBe("file");
  });
});

describe("taking everything with you", () => {
  useCleanDatabase();

  it("puts the photographs themselves in the archive, not just their URLs", async () => {
    const account = await signUp();

    const upload = await request(app)
      .post("/api/uploads")
      .set("Cookie", account.cookie)
      .attach("file", PNG, "her-birthday.png")
      .expect(201);

    await request(app)
      .post("/api/memories")
      .set("Cookie", account.cookie)
      .send({ title: "Her last birthday", imageUrl: upload.body.url })
      .expect(201);

    const archive = await request(app)
      .get("/api/auth/export/archive")
      .set("Cookie", account.cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(archive.headers["content-type"]).toContain("application/zip");
    expect(archive.headers["content-disposition"]).toContain(
      "holding-today-export.zip",
    );

    const files = readZip(archive.body as Buffer);

    const photo = files.get(`files/${upload.body.id}-her-birthday.png`);
    expect(photo).toBeDefined();
    expect(photo).toEqual(PNG);

    const manifest = JSON.parse(files.get("export.json")!.toString("utf8"));
    expect(manifest.account.email).toBe(account.email);
    expect(manifest.data.memories).toHaveLength(1);
    expect(JSON.stringify(manifest)).not.toContain("scrypt");
  });

  it("includes everything an account can write, not only the original tables", async () => {
    const account = await signUp();

    await request(app)
      .post("/api/belongings")
      .set("Cookie", account.cookie)
      .send({ item: "His leather jacket" })
      .expect(201);
    await request(app)
      .post("/api/gifts")
      .set("Cookie", account.cookie)
      .send({ fromName: "The Hendersons", kind: "food" })
      .expect(201);
    await request(app)
      .post("/api/contacts")
      .set("Cookie", account.cookie)
      .send({ name: "His football coach" })
      .expect(201);
    await request(app)
      .post("/api/obituaries")
      .set("Cookie", account.cookie)
      .send({ label: "For the paper" })
      .expect(201);
    await request(app)
      .post("/api/memorial-choices")
      .set("Cookie", account.cookie)
      .send({ category: "song", title: "The one he played constantly" })
      .expect(201);

    const exported = await request(app)
      .get("/api/auth/export")
      .set("Cookie", account.cookie)
      .expect(200);

    expect(exported.body.data.belongings).toHaveLength(1);
    expect(exported.body.data.gifts).toHaveLength(1);
    expect(exported.body.data.contacts).toHaveLength(1);
    expect(exported.body.data.obituaries).toHaveLength(1);
    expect(exported.body.data.memorialChoices).toHaveLength(1);
    expect(exported.body.data.signs).toEqual([]);
  });

  it("is closed to anyone without a session", async () => {
    await request(app).get("/api/auth/export/archive").expect(401);
  });
});

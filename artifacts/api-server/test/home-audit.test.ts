import { describe, expect, it } from "vitest";
import {
  PNG_BYTES,
  asFamily,
  createCase,
  inviteFamily,
  signUpHome,
} from "./helpers";

/**
 * Findings from the staff-console audit, each pinned so it cannot come back.
 *
 * The tenant boundary is the one tested most carefully in this suite, and all
 * of these were still ways across it: not through a case id, which every
 * route checks, but through the smaller ids that ride along in a body and
 * were trusted because nobody expected them to point anywhere else.
 */
describe("ids a home writes into its own rows", () => {
  it("cannot point the home's logo at another home's upload", async () => {
    const mine = await signUpHome("Alpha");
    const theirs = await signUpHome("Bravo");

    const foreign = await theirs.agent
      .post("/api/uploads")
      .attach("file", PNG_BYTES, "theirs.png")
      .expect(201);

    await mine.agent
      .put("/api/home")
      .send({ logoUploadId: foreign.body.id })
      .expect(400);

    // Its own staff upload is fine, which is the point of the field.
    const own = await mine.agent
      .post("/api/uploads")
      .attach("file", PNG_BYTES, "logo.png")
      .expect(201);
    await mine.agent
      .put("/api/home")
      .send({ logoUploadId: own.body.id })
      .expect(200);
  });

  it("cannot use one family's photograph as the logo every family sees", async () => {
    const staff = await signUpHome();
    const kase = await createCase(staff);
    const { token } = await inviteFamily(staff, kase.id);

    const photo = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "mum.png")
      .expect(201);

    await staff.agent
      .put("/api/home")
      .send({ logoUploadId: photo.body.uploadId })
      .expect(400);
  });

  it("does not inline another home's file into a printed card, even from an old row", async () => {
    const mine = await signUpHome("Alpha");
    const theirs = await signUpHome("Bravo");

    const foreign = await theirs.agent
      .post("/api/uploads")
      .attach("file", PNG_BYTES, "theirs.png")
      .expect(201);

    // A row written before the settings check existed.
    const { db, funeralHomesTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    await db
      .update(funeralHomesTable)
      .set({ logoUploadId: foreign.body.id })
      .where(eq(funeralHomesTable.id, mine.homeId));

    const kase = await createCase(mine);
    const item = await mine.agent
      .post(`/api/cases/${kase.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    const rendered = await mine.agent
      .get(`/api/print/${item.body.id}/render`)
      .expect(200);

    expect(rendered.text).not.toContain("data:image");
  });

  it("cannot point a case's reference photo at another home's photograph", async () => {
    const mine = await signUpHome("Alpha");
    const theirs = await signUpHome("Bravo");

    const theirCase = await createCase(theirs);
    const { token } = await inviteFamily(theirs, theirCase.id);
    const photo = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "theirs.png")
      .expect(201);

    const myCase = await createCase(mine);
    await mine.agent
      .put(`/api/cases/${myCase.id}`)
      .send({ referencePhotoId: photo.body.id })
      .expect(400);

    const prep = await mine.agent
      .get(`/api/cases/${myCase.id}/preparation`)
      .expect(200);
    expect(prep.body.referencePhotoUploadId).toBeNull();
  });
});

describe("the photo pack", () => {
  it("keeps the file extension however long the caption", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, writeFileSync, readdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");

    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const photo = await asFamily(token)
      .post("/api/family/photos")
      .field(
        "caption",
        "Mum at the lake the summer before Dad retired, with the dog that " +
          "would not sit still and the boat Uncle Ray never finished painting",
      )
      .attach("file", PNG_BYTES, "a.png")
      .expect(201);

    await staff.agent
      .put(`/api/cases/${row.id}/photos/selection`)
      .send({ photoIds: [photo.body.id] })
      .expect(200);

    const pack = await staff.agent
      .get(`/api/cases/${row.id}/photo-pack`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const dir = mkdtempSync(path.join(tmpdir(), "pack-"));
    writeFileSync(path.join(dir, "pack.zip"), pack.body as Buffer);
    execFileSync("unzip", ["-q", path.join(dir, "pack.zip"), "-d", path.join(dir, "out")]);

    const images = readdirSync(path.join(dir, "out")).filter(
      (name) => name !== "captions.txt",
    );
    expect(images).toHaveLength(1);
    expect(images[0]).toMatch(/^01-Mum-at-the-lake.*\.png$/);
  });
});

describe("ids from a URL", () => {
  it("answers a number too large to be an id with a 400, not a 500", async () => {
    const staff = await signUpHome();
    await staff.agent.get("/api/cases/99999999999").expect(400);
  });

  it("answers an impossible photograph year with a 400, not a 500", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const photo = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "a.png")
      .expect(201);

    await staff.agent
      .patch(`/api/photos/${photo.body.id}`)
      .send({ takenYear: 1500 })
      .expect(400);
    await staff.agent
      .patch(`/api/photos/${photo.body.id}`)
      .send({ takenYear: 1974 })
      .expect(200);
  });
});

describe("the one thing the subscription gates", () => {
  it("cannot be walked round with a spreadsheet", async () => {
    const staff = await signUpHome();
    const { db, funeralHomesTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "canceled" })
      .where(eq(funeralHomesTable.id, staff.homeId));

    const csv = "Last Name,First Name\r\nHale,Margaret\r\n";

    // Looking is free...
    await staff.agent
      .post("/api/cases/import/preview")
      .attach("file", Buffer.from(csv, "utf8"), "export.csv")
      .expect(200);

    // ...opening cases is the same answer `POST /cases` gives.
    await staff.agent
      .post("/api/cases/import")
      .attach("file", Buffer.from(csv, "utf8"), "export.csv")
      .expect(402);
    await staff.agent
      .post("/api/cases")
      .send({ decedentFirstName: "A", decedentLastName: "B" })
      .expect(402);

    const cases = await staff.agent.get("/api/cases").expect(200);
    expect(cases.body).toHaveLength(0);
  });
});

describe("accepting a request from the public page", () => {
  it("opens one case when two directors accept at the same moment", async () => {
    const request = (await import("supertest")).default;
    const app = (await import("../src/app")).default;
    const { db, funeralHomesTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    const staff = await signUpHome();
    const [home] = await db
      .select({ slug: funeralHomesTable.slug })
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, staff.homeId));

    // A second session for the same home: a colleague at the next desk.
    const colleague = request.agent(app);
    await colleague
      .post("/api/auth/login")
      .send({ email: staff.email, password: "correct-horse-battery" })
      .expect(200);

    await request(app)
      .post("/api/public/intake")
      .send({
        homeSlug: home!.slug,
        kind: "at_need",
        requesterName: "Marie Vance",
        requesterPhone: "+15555550142",
        relationship: "Daughter",
        subjectFirstName: "Eleanor",
        subjectLastName: "Vance",
      })
      .expect(202);

    const queue = await staff.agent.get("/api/intake-requests").expect(200);
    const id = queue.body[0].id;

    const [first, second] = await Promise.all([
      staff.agent.post(`/api/intake-requests/${id}/accept`),
      colleague.post(`/api/intake-requests/${id}/accept`),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    // Before the claim moved to the front, the loser's 409 arrived after its
    // case, its family link and its billable funeral had been written.
    const cases = await staff.agent.get("/api/cases").expect(200);
    expect(cases.body).toHaveLength(1);
  });
});

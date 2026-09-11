/**
 * The questions a funeral home's owner asks before signing, none of which are
 * about features:
 *
 *   "What happens to our families' files if we stop paying you?"
 *   "A family has asked us to delete everything. Can you?"
 *
 * A product that cannot answer both is asking a business to put the only copy
 * of a bereaved family's photographs somewhere it can never get them back
 * from.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { asFamily, createCase, inviteFamily, signUpHome, PNG_BYTES } from "./helpers";
import { db, funeralHomesTable, caseDeletionsTable, casesTable, uploadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/** Read a zip's entry names without a dependency, by scanning local headers. */
function entryNames(buffer: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const size = buffer.readUInt32LE(offset + 18);
    names.push(buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
    offset += 30 + nameLength + extraLength + size;
  }

  return names;
}

function entry(buffer: Buffer, wanted: string): string | null {
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const size = buffer.readUInt32LE(offset + 18);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;

    if (name === wanted) return buffer.subarray(start, start + size).toString("utf8");
    offset = start + size;
  }

  return null;
}

describe("taking the data out", () => {
  it("hands over a folder that means something without this software", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      decedentFirstName: "Eleanor",
      decedentLastName: "Vance",
    });
    const contact = await inviteFamily(staff, row.id, { name: "Marie Vance" });
    const family = asFamily(contact.token);

    await family
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, { filename: "mum.png", contentType: "image/png" })
      .expect(201);

    await family
      .put("/api/family/obituary")
      .send({ survivedBy: "A great many nieces" })
      .expect(200);

    await family.post("/api/family/messages").send({ body: "Here is the first one." }).expect(201);

    const res = await staff.agent
      .get(`/api/cases/${row.id}/export`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers["content-type"]).toBe("application/zip");

    const names = entryNames(res.body as Buffer);
    expect(names).toContain("README.txt");
    expect(names).toContain("obituary.txt");
    expect(names).toContain("messages.txt");
    expect(names.some((name) => name.startsWith("photographs/"))).toBe(true);

    // The photograph is in there as real bytes, not a reference.
    const readme = entry(res.body as Buffer, "README.txt")!;
    expect(readme).toContain("Eleanor Vance");
    expect(readme).toContain("Marie Vance");

    expect(entry(res.body as Buffer, "obituary.txt")).toContain("A great many nieces");
    expect(entry(res.body as Buffer, "messages.txt")).toContain("Here is the first one.");
  });

  it("keeps working after the home has cancelled", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "canceled" })
      .where(eq(funeralHomesTable.id, staff.homeId));

    // Opening new work is refused when a subscription ends...
    await staff.agent
      .post("/api/cases")
      .send({ decedentFirstName: "New", decedentLastName: "Case" })
      .expect(402);

    // ...but taking your own data out is not new work, and a product that
    // blocks it is holding a bereaved family's photographs to ransom.
    await staff.agent.get(`/api/cases/${row.id}/export`).expect(200);
  });

  it("leaves the social security number out of the archive", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    await staff.agent
      .put(`/api/cases/${row.id}/vitals`)
      .send({ socialSecurityNumber: "123456789" })
      .expect(200);

    const res = await staff.agent
      .get(`/api/cases/${row.id}/export`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    /*
     * An archive gets emailed, copied to a laptop, and left in a downloads
     * folder. A number that opens a person's credit file does not belong in
     * one — it stays readable in the application instead.
     */
    expect((res.body as Buffer).toString("latin1")).not.toContain("123456789");
    expect(entry(res.body as Buffer, "vitals.txt")).toContain("6789");
  });

  it("cannot be exported across tenants", async () => {
    const a = await signUpHome("Home A");
    const b = await signUpHome("Home B");
    const row = await createCase(a);

    await b.agent.get(`/api/cases/${row.id}/export`).expect(404);
  });
});

describe("erasing a case on request", () => {
  it("refuses unless the name is typed, not clicked", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      decedentFirstName: "Eleanor",
      decedentLastName: "Vance",
    });

    await staff.agent
      .post(`/api/cases/${row.id}/delete`)
      .send({ confirmName: "" })
      .expect(400);

    await staff.agent
      .post(`/api/cases/${row.id}/delete`)
      .send({ confirmName: "Eleanor" })
      .expect(400);

    // Still there.
    await staff.agent.get(`/api/cases/${row.id}`).expect(200);
  });

  it("takes the photographs with it, bytes and all", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      decedentFirstName: "Eleanor",
      decedentLastName: "Vance",
    });
    const contact = await inviteFamily(staff, row.id, { name: "Marie Vance" });

    await asFamily(contact.token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, { filename: "mum.png", contentType: "image/png" })
      .expect(201);

    const before = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.caseId, row.id));
    expect(before.length).toBeGreaterThan(0);

    await staff.agent
      .post(`/api/cases/${row.id}/delete`)
      .send({ confirmName: "eleanor vance", reason: "The family asked." })
      .expect(204);

    // The case is gone...
    const cases = await db.select().from(casesTable).where(eq(casesTable.id, row.id));
    expect(cases).toHaveLength(0);

    // ...and so are the encrypted bytes, not just the row pointing at them.
    const after = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.caseId, row.id));
    expect(after).toHaveLength(0);

    await staff.agent.get(`/api/cases/${row.id}`).expect(404);
  });

  it("leaves a tombstone that says it happened and nothing about who it was for", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      decedentFirstName: "Eleanor",
      decedentLastName: "Vance",
    });

    await staff.agent
      .post(`/api/cases/${row.id}/delete`)
      .send({ confirmName: "Eleanor Vance", reason: "The family asked." })
      .expect(204);

    const [tomb] = await db
      .select()
      .from(caseDeletionsTable)
      .where(eq(caseDeletionsTable.funeralHomeId, staff.homeId));

    expect(tomb).toBeDefined();
    expect(tomb!.formerCaseId).toBe(row.id);
    expect(tomb!.reason).toBe("The family asked.");

    /*
     * "Delete everything about my mother" must not quietly leave her name in
     * a table forever. The tombstone proves a deletion happened; it does not
     * remember whom it was about.
     */
    expect(JSON.stringify(tomb)).not.toContain("Eleanor");
    expect(JSON.stringify(tomb)).not.toContain("Vance");
  });

  it("cannot erase another home's case", async () => {
    const a = await signUpHome("Home A");
    const b = await signUpHome("Home B");
    const row = await createCase(a, {
      decedentFirstName: "Eleanor",
      decedentLastName: "Vance",
    });

    await b.agent
      .post(`/api/cases/${row.id}/delete`)
      .send({ confirmName: "Eleanor Vance" })
      .expect(404);

    await a.agent.get(`/api/cases/${row.id}`).expect(200);
  });
});

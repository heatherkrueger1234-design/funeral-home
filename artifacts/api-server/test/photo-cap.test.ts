/**
 * The thousand-photograph ceiling, under the load that tests it.
 *
 * The count used to be taken before the upload's transaction began, so
 * photographs arriving together at the 999th all counted 999 and all landed.
 * The family portal sends one at a time, but two relatives on two phones do
 * not, and neither does a director's panel beside them.
 */
import { describe, expect, it } from "vitest";
import { asFamily, createCase, inviteFamily, PNG_BYTES, signUpHome } from "./helpers";
import { MAX_PHOTOS_PER_CASE, casePhotosTable, db, uploadsTable } from "@workspace/db";
import { encryptBuffer } from "@workspace/db/crypto";
import { count, eq } from "drizzle-orm";

describe("the photograph ceiling", () => {
  it("lets exactly the last places go when several arrive at once", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { contactId } = await inviteFamily(staff, row.id);
    const sister = await inviteFamily(staff, row.id, { name: "Ruth Hale", role: "contributor" });
    const brother = await inviteFamily(staff, row.id, { name: "Tom Hale", role: "contributor" });

    // Two places left, filled straight into the tables: a thousand uploads
    // through the API would make this the slowest test in the suite.
    const stored = await db
      .insert(uploadsTable)
      .values(
        Array.from({ length: MAX_PHOTOS_PER_CASE - 2 }, (_, i) => ({
          funeralHomeId: staff.homeId,
          caseId: row.id,
          uploadedByContactId: contactId,
          filename: `old-${i}.png`,
          mimeType: "image/png",
          sizeBytes: PNG_BYTES.length,
          data: encryptBuffer(PNG_BYTES),
        })),
      )
      .returning({ id: uploadsTable.id });
    await db.insert(casePhotosTable).values(
      stored.map((upload, i) => ({
        funeralHomeId: staff.homeId,
        caseId: row.id,
        uploadId: upload.id,
        uploadedByContactId: contactId,
        position: i,
      })),
    );

    // Six at once, from two relatives' phones.
    const sends = await Promise.all(
      [sister, brother, sister, brother, sister, brother].map((who, i) =>
        asFamily(who.token)
          .post("/api/family/photos")
          .attach("file", PNG_BYTES, `new-${i}.png`),
      ),
    );

    const statuses = sends.map((res) => res.status).sort();
    expect(statuses).toEqual([201, 201, 400, 400, 400, 400]);
    for (const refused of sends.filter((res) => res.status === 400)) {
      expect(refused.body.error).toMatch(/1000-photograph limit/);
    }

    const [held] = await db
      .select({ value: count() })
      .from(casePhotosTable)
      .where(eq(casePhotosTable.caseId, row.id));
    expect(Number(held!.value)).toBe(MAX_PHOTOS_PER_CASE);

    // And no orphaned bytes from the ones refused inside the transaction.
    const [bytes] = await db
      .select({ value: count() })
      .from(uploadsTable)
      .where(eq(uploadsTable.caseId, row.id));
    expect(Number(bytes!.value)).toBe(MAX_PHOTOS_PER_CASE);
  });
});

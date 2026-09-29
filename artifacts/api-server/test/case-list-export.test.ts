import { describe, expect, it } from "vitest";
import { csvCell, guessMapping, parseCsv } from "../src/lib/csv";
import { createCase, signUpHome } from "./helpers";

describe("every case as a CSV", () => {
  it("exports this home's cases in columns our importer reads back", async () => {
    const staff = await signUpHome();
    const other = await signUpHome("Mesa Verde");
    const row = await createCase(staff, {
      dateOfBirth: "1941-03-19",
      serviceAt: "2026-09-18T19:00:00Z",
      serviceLocation: "St Mary's, Denver",
    });
    await staff.agent
      .post(`/api/cases/${row.id}/contacts`)
      .send({ name: "Anne Hale", relationship: "Daughter", phone: "303-555-0142", role: "next_of_kin" })
      .expect(201);
    await createCase(other, { decedentFirstName: "Someone", decedentLastName: "Else" });

    const res = await staff.agent.get("/api/export/cases.csv").expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="cases-/);

    const parsed = parseCsv(res.text);
    expect(parsed.rows).toHaveLength(1);
    const mapping = guessMapping(parsed.headers);
    for (const field of ["decedentFirstName", "decedentLastName", "dateOfBirth", "serviceAt", "contactName", "contactPhone"]) {
      expect(mapping[field], field).not.toBeNull();
    }
    const first = Object.values(parsed.rows[0]!).join("|");
    expect(first).toContain("Margaret");
    expect(first).toContain("1941-03-19");
    // 19:00 UTC is 13:00 in Denver.
    expect(first).toContain("2026-09-18 13:00");
    expect(first).toContain("Anne Hale");
    expect(res.text).not.toContain("Someone");
  });

  it("will not hand a spreadsheet a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1 303")).toBe("'+1 303");
    expect(csvCell("Hale, Margaret")).toBe("\"Hale, Margaret\"");
    expect(csvCell(null)).toBe("");
  });
});

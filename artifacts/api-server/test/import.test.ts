import { describe, expect, it } from "vitest";
import { parseCsv, parseDate, guessMapping } from "../src/lib/csv";
import { createCase, signUpHome } from "./helpers";

/**
 * Importing what a home's existing system actually exports.
 *
 * The inputs here are deliberately ugly, because real ones are: a BOM from
 * Excel, CRLF line endings, quoted addresses containing commas, doubled
 * quotes, and trailing blank lines. A regex split on commas passes a clean
 * fixture and mangles every real file.
 */
describe("reading a real export", () => {
  it("survives Excel", () => {
    const csv =
      "﻿Last Name,First Name,Service Location,Phone\r\n" +
      'Hale,Margaret,"St Mary\'s Chapel, Leeds",303-555-0142\r\n' +
      'Okonkwo,Ronald,"The ""Old"" Chapel",303-555-0143\r\n' +
      "\r\n";

    const parsed = parseCsv(csv);

    // The BOM did not eat the first header.
    expect(parsed.headers[0]).toBe("Last Name");
    // The trailing blank line is not a case.
    expect(parsed.rows).toHaveLength(2);
    // A comma inside quotes is not a column break.
    expect(parsed.rows[0]!["servicelocation"]).toBe("St Mary's Chapel, Leeds");
    // Doubled quotes are one literal quote.
    expect(parsed.rows[1]!["servicelocation"]).toBe('The "Old" Chapel');
  });

  it("handles a newline inside a quoted field", () => {
    const csv = 'Last Name,Notes\nHale,"Line one\nLine two"\n';
    const parsed = parseCsv(csv);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!["notes"]).toBe("Line one\nLine two");
  });

  it("recognises columns whatever they are called", () => {
    for (const headers of [
      ["Last Name", "First Name", "DOB"],
      ["last_name", "first_name", "date_of_birth"],
      ["SURNAME", "GivenName", "BirthDate"],
    ]) {
      const mapping = guessMapping(headers);
      expect(mapping["decedentLastName"]).toBe(headers[0]);
      expect(mapping["decedentFirstName"]).toBe(headers[1]);
      expect(mapping["dateOfBirth"]).toBe(headers[2]);
    }
  });

  it("reads the dates these systems emit, and refuses to guess", () => {
    expect(parseDate("2026-03-04")?.getMonth()).toBe(2);
    expect(parseDate("3/4/2026")?.getMonth()).toBe(2); // US month/day
    expect(parseDate("03-04-26")?.getFullYear()).toBe(2026);

    // 13 cannot be a month, so it can only be a day.
    const unambiguous = parseDate("13/4/2026");
    expect(unambiguous?.getMonth()).toBe(3);
    expect(unambiguous?.getDate()).toBe(13);

    // Nonsense is null, not a confident wrong date.
    expect(parseDate("next Tuesday")).toBeNull();
    expect(parseDate("99/99/9999")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("importing cases", () => {
  const csv =
    "﻿Last Name,First Name,Service Date,Next of Kin,Relationship,Phone,Zip\r\n" +
    "Hale,Margaret,2026-09-18 13:00,Anne Hale,Daughter,303-555-0142,80202\r\n" +
    "Okonkwo,Ronald,not a date,Grace Okonkwo,Wife,303-555-0143,80301\r\n" +
    ",,,,,,\r\n";

  it("shows what would happen before writing anything", async () => {
    const staff = await signUpHome();

    const preview = await staff.agent
      .post("/api/cases/import/preview")
      .attach("file", Buffer.from(csv, "utf8"), "export.csv")
      .expect(200);

    expect(preview.body.wouldCreate).toBe(2);
    expect(preview.body.wouldSkip).toBe(0);
    expect(preview.body.rows[0].decedentName).toBe("Margaret Hale");
    expect(preview.body.rows[0].contactName).toBe("Anne Hale");
    expect(preview.body.mapping.decedentLastName).toBe("Last Name");

    // The bad date is reported rather than silently guessed.
    expect(
      preview.body.issues.some((i: { message: string }) =>
        i.message.includes("service date"),
      ),
    ).toBe(true);

    // And nothing was created.
    const cases = await staff.agent.get("/api/cases").expect(200);
    expect(cases.body).toHaveLength(0);
  });

  it("creates the cases, with contacts and a schedule", async () => {
    const staff = await signUpHome();

    const result = await staff.agent
      .post("/api/cases/import")
      .attach("file", Buffer.from(csv, "utf8"), "export.csv")
      .expect(200);

    expect(result.body.created).toBe(2);

    const cases = await staff.agent.get("/api/cases").expect(200);
    expect(cases.body).toHaveLength(2);

    const margaret = cases.body.find(
      (c: { decedentLastName: string }) => c.decedentLastName === "Hale",
    );
    expect(margaret.nextOfKinName).toBe("Anne Hale");
    expect(margaret.postalCode).toBe("80202");

    // A service date means the standard schedule was built.
    const deadlines = await staff.agent
      .get(`/api/cases/${margaret.id}/deadlines`)
      .expect(200);
    expect(deadlines.body.length).toBeGreaterThan(0);

    // The contact exists but no link was sent: texting twenty grieving
    // families because somebody dropped in a spreadsheet is not a side effect.
    const contacts = await staff.agent
      .get(`/api/cases/${margaret.id}/contacts`)
      .expect(200);
    expect(contacts.body).toHaveLength(1);
    expect(contacts.body[0].firstSeenAt).toBeNull();
  });

  it("is safe to run twice on the same daily export", async () => {
    const staff = await signUpHome();

    await staff.agent
      .post("/api/cases/import")
      .attach("file", Buffer.from(csv, "utf8"), "export.csv")
      .expect(200);

    const second = await staff.agent
      .post("/api/cases/import")
      .attach("file", Buffer.from(csv, "utf8"), "export.csv")
      .expect(200);

    expect(second.body.created).toBe(0);
    expect(second.body.skipped).toBe(2);

    const cases = await staff.agent.get("/api/cases").expect(200);
    expect(cases.body).toHaveLength(2);
  });

  it("does not treat a closed case as a duplicate", async () => {
    const staff = await signUpHome();
    const existing = await createCase(staff, {
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
    });
    await staff.agent.post(`/api/cases/${existing.id}/close`).expect(200);

    const result = await staff.agent
      .post("/api/cases/import")
      .attach("file", Buffer.from(csv, "utf8"), "export.csv")
      .expect(200);

    // Two people with the same name in different years are two cases.
    expect(result.body.created).toBe(2);
  });

  it("refuses a file with no name column rather than importing blanks", async () => {
    const staff = await signUpHome();
    const useless = "Colour,Size\r\nred,large\r\n";

    await staff.agent
      .post("/api/cases/import")
      .attach("file", Buffer.from(useless, "utf8"), "wrong.csv")
      .expect(400);
  });
});

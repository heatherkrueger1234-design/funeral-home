import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { casesTable, db } from "@workspace/db";
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
    expect(parseDate("2026-03-04")).toMatchObject({ year: 2026, month: 3, day: 4, time: null });
    expect(parseDate("3/4/2026")).toMatchObject({ month: 3, day: 4 }); // US month/day
    expect(parseDate("03-04-26")?.year).toBe(2026);

    // 13 cannot be a month, so it can only be a day.
    expect(parseDate("13/4/2026")).toMatchObject({ month: 4, day: 13 });

    // Nonsense is null, not a confident wrong date.
    expect(parseDate("next Tuesday")).toBeNull();
    expect(parseDate("99/99/9999")).toBeNull();
    expect(parseDate("")).toBeNull();
  });

  it("refuses a day that does not exist rather than rolling it into the next month", () => {
    expect(parseDate("2026-02-31")).toBeNull();
    expect(parseDate("02/30/2026")).toBeNull();
    expect(parseDate("0/15/2026")).toBeNull();
    expect(parseDate("3/4/202")).toBeNull();
    // A leap day is a real day.
    expect(parseDate("2/29/2024")).toMatchObject({ month: 2, day: 29 });
  });

  it("reads the time of day as written, morning or afternoon", () => {
    expect(parseDate("9/18/2026 1:00 PM")?.time).toEqual({ hour: 13, minute: 0 });
    expect(parseDate("09/18/2026 11:30 a.m.")?.time).toEqual({ hour: 11, minute: 30 });
    expect(parseDate("9/18/2026 12:15 AM")?.time).toEqual({ hour: 0, minute: 15 });
    expect(parseDate("9/18/2026 12:00 PM")?.time).toEqual({ hour: 12, minute: 0 });
    expect(parseDate("9/18/2026 2 PM")?.time).toEqual({ hour: 14, minute: 0 });
    expect(parseDate("2026-09-18 13:00:00")?.time).toEqual({ hour: 13, minute: 0 });
    expect(parseDate("9/18/2026 1:00 PM MDT")?.time).toEqual({ hour: 13, minute: 0 });

    // A time that cannot be is not quietly some other time.
    expect(parseDate("9/18/2026 13:00 PM")).toBeNull();
    expect(parseDate("9/18/2026 25:00")).toBeNull();
    expect(parseDate("9/18/2026 1300")).toBeNull();
  });

  it("keeps an instant the export named with its own offset", () => {
    expect(parseDate("2026-09-18T19:00:00Z")?.instant?.toISOString()).toBe(
      "2026-09-18T19:00:00.000Z",
    );
    expect(parseDate("2026-09-18T13:00:00-06:00")?.instant?.toISOString()).toBe(
      "2026-09-18T19:00:00.000Z",
    );
    // Without one, the time is on the home's clock, which only the importer knows.
    expect(parseDate("9/18/2026 1:00 PM")?.instant).toBeNull();
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

  /*
   * The cards, the family's page and the export all show a service on the
   * home's clock, and the file's "1:00 PM" is that clock. It used to be read
   * as one o'clock UTC: seven in the morning in Colorado, on every card.
   */
  it("puts each service at the time the file says, on the home's clock", async () => {
    const staff = await signUpHome(); // America/Denver, the default
    const file =
      "Last Name,First Name,Service Date,Date of Birth\r\n" +
      "Hale,Margaret,9/18/2026 1:00 PM,4/2/1941\r\n" +
      "Lee,Grace,12/5/2026 2:30 PM,\r\n" +
      "Vance,Edith,2026-07-04,\r\n" +
      "Ruiz,Tomas,2026-12-05T14:30:00-05:00,\r\n" +
      "Ng,Amy,,4/12/38\r\n";

    const result = await staff.agent
      .post("/api/cases/import")
      .attach("file", Buffer.from(file, "utf8"), "export.csv")
      .expect(200);
    expect(result.body.created).toBe(5);

    const rows = await db
      .select()
      .from(casesTable)
      .where(eq(casesTable.funeralHomeId, staff.homeId));
    const named = (last: string) => rows.find((row) => row.decedentLastName === last)!;
    const said = (text: string) =>
      result.body.issues.some((issue: { message: string }) => issue.message.includes(text));

    // 1:00 PM in September is MDT, six hours behind UTC; 2:30 PM in
    // December is MST, seven.
    expect(named("Hale").serviceAt?.toISOString()).toBe("2026-09-18T19:00:00.000Z");
    expect(named("Lee").serviceAt?.toISOString()).toBe("2026-12-05T21:30:00.000Z");
    // A birthday is a calendar day, kept at UTC midnight like the console's.
    expect(named("Hale").dateOfBirth?.toISOString()).toBe("1941-04-02T00:00:00.000Z");

    // A day with no time is left for the director, and they are told.
    expect(named("Vance").serviceAt).toBeNull();
    expect(said('"2026-07-04" has no time')).toBe(true);

    // An offset the file gave itself is believed over the home's clock.
    expect(named("Ruiz").serviceAt?.toISOString()).toBe("2026-12-05T19:30:00.000Z");

    // "38" read as 2038 is nobody's birthday: blank, and said so.
    expect(named("Ng").dateOfBirth).toBeNull();
    expect(said("in the future")).toBe(true);
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

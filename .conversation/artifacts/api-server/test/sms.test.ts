import { describe, expect, it } from "vitest";
import { normalisePhone } from "../src/lib/sms";
import { createCase, signUpHome } from "./helpers";

/**
 * Getting a number wrong here means a link to a grieving family's
 * photographs arriving on a stranger's phone, so the normaliser refuses
 * ambiguity rather than guessing.
 */
describe("phone normalisation", () => {
  it("accepts what a director actually types", () => {
    expect(normalisePhone("(303) 555-0142")).toBe("+13035550142");
    expect(normalisePhone("303-555-0142")).toBe("+13035550142");
    expect(normalisePhone("303.555.0142")).toBe("+13035550142");
    expect(normalisePhone(" 3035550142 ")).toBe("+13035550142");
  });

  it("leaves an international number alone", () => {
    expect(normalisePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalisePhone("+13035550142")).toBe("+13035550142");
  });

  it("does not double the country code on a number that has one", () => {
    expect(normalisePhone("1-303-555-0142")).toBe("+13035550142");
  });

  it("refuses what it cannot be sure of", () => {
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone("   ")).toBeNull();
    expect(normalisePhone("ask Anne")).toBeNull();
    expect(normalisePhone("555-0142")).toBeNull(); // too short to place
    expect(normalisePhone("1".repeat(20))).toBeNull();
  });

  it("honours a different default country", () => {
    expect(normalisePhone("07700 900123", "+44")).toBe("+4407700900123");
  });
});

describe("texting the link", () => {
  it("refuses when there is no mobile number on file", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const contact = await staff.agent
      .post(`/api/cases/${row.id}/contacts`)
      .send({ name: "Anne Hale" })
      .expect(201);

    await staff.agent
      .post(`/api/contacts/${contact.body.id}/send-link`)
      .expect(400);
  });

  it("still hands the director the link when the text cannot go", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const contact = await staff.agent
      .post(`/api/cases/${row.id}/contacts`)
      .send({ name: "Anne Hale", phone: "(303) 555-0142" })
      .expect(201);

    // No Twilio credentials in the test environment, so this is the partial
    // failure a real home hits on day one.
    const result = await staff.agent
      .post(`/api/contacts/${contact.body.id}/send-link`)
      .expect(200);

    expect(result.body.sent).toBe(false);
    expect(result.body.smsError).toBeTruthy();
    // The important part: they are not left with nothing.
    expect(result.body.link).toContain("/f/");

    // And the freshly minted link works, while the old one does not.
    const { asFamily } = await import("./helpers");
    const fresh = String(result.body.link).split("/f/")[1]!;
    await asFamily(fresh).get("/api/family/session").expect(200);

    const original = String(contact.body.link).split("/f/")[1]!;
    await asFamily(original).get("/api/family/session").expect(401);
  });
});

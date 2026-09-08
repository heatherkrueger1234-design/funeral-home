import { describe, expect, it } from "vitest";
import { isWithinOfficeHours, formatMinute, minutesInZone } from "../src/lib/office-hours";
import { composeObituary } from "../src/lib/obituary";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

const home = (over: Partial<Parameters<typeof isWithinOfficeHours>[0]> = {}) => ({
  officeOpensMinute: 8 * 60,
  officeClosesMinute: 17 * 60,
  timezone: "America/Denver",
  ...over,
});

describe("office hours", () => {
  it("reads the clock in the home's own timezone, not the server's", () => {
    // 15:00 UTC is 08:00 in Denver (MDT) and 16:00 in London.
    const at = new Date("2026-06-01T15:00:00Z");

    expect(minutesInZone(at, "America/Denver")).toBe(9 * 60);
    expect(minutesInZone(at, "Europe/London")).toBe(16 * 60);
  });

  it("is closed at two in the morning and open at ten", () => {
    expect(isWithinOfficeHours(home(), new Date("2026-06-01T08:00:00Z"))).toBe(false); // 02:00 MDT
    expect(isWithinOfficeHours(home(), new Date("2026-06-01T16:00:00Z"))).toBe(true); // 10:00 MDT
  });

  it("handles a home whose hours wrap past midnight", () => {
    // Open 17:00, closed 02:00. Denver is UTC-6 in June.
    const evening = home({ officeOpensMinute: 17 * 60, officeClosesMinute: 2 * 60 });
    const at = (iso: string) => new Date(iso);

    // Inside the window, on both sides of midnight.
    expect(isWithinOfficeHours(evening, at("2026-06-02T01:00:00Z"))).toBe(true); // 19:00
    expect(isWithinOfficeHours(evening, at("2026-06-01T06:30:00Z"))).toBe(true); // 00:30

    // Outside it: the middle of the afternoon, and the closing edge itself,
    // which is exclusive.
    expect(isWithinOfficeHours(evening, at("2026-06-01T20:00:00Z"))).toBe(false); // 14:00
    expect(isWithinOfficeHours(evening, at("2026-06-01T08:00:00Z"))).toBe(false); // 02:00
  });

  it("treats equal open and close as never closing", () => {
    const always = home({ officeOpensMinute: 0, officeClosesMinute: 0 });
    expect(isWithinOfficeHours(always, new Date("2026-06-01T08:00:00Z"))).toBe(true);
  });

  it("formats a minute for the sentence the family reads", () => {
    expect(formatMinute(8 * 60)).toBe("8:00 AM");
    expect(formatMinute(17 * 60)).toBe("5:00 PM");
    expect(formatMinute(0)).toBe("12:00 AM");
    expect(formatMinute(12 * 60 + 30)).toBe("12:30 PM");
  });
});

describe("the obituary composer", () => {
  const blank = {
    fullName: null,
    bornOn: null,
    birthPlace: null,
    diedOn: null,
    deathPlace: null,
    survivedBy: null,
    precededBy: null,
    biography: null,
    inLieuOfFlowers: null,
    specialThanks: null,
  };

  it("invents nothing when it is given nothing", () => {
    expect(composeObituary(blank)).toBe("");
  });

  it("leaves out the paragraphs it has no facts for", () => {
    const text = composeObituary({ ...blank, fullName: "Peggy Hale", diedOn: "2 September" });

    expect(text).toBe("Peggy Hale died on 2 September.");
    expect(text).not.toContain("Survived by");
    expect(text).not.toContain("null");
  });

  it("keeps the family's own words for the life, unedited", () => {
    const biography = "she taught at Beckett Park for thirty-one years and never once raised her voice";
    expect(composeObituary({ ...blank, biography })).toContain(biography);
  });

  it("does not double up punctuation the family already wrote", () => {
    const text = composeObituary({ ...blank, survivedBy: "her daughters Anne and Judith." });
    expect(text).toBe("Survived by her daughters Anne and Judith.");
    expect(text).not.toContain("..");
  });
});

describe("the thread ends", () => {
  it("locks a fortnight after the service, for both sides", async () => {
    const staff = await signUpHome();

    // A service that already happened, so the lock date is in the past.
    const serviceAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const row = await createCase(staff, { serviceAt: serviceAt.toISOString() });
    const { token } = await inviteFamily(staff, row.id, { email: "anne@example.com" });

    // Before closing, both sides can write.
    await asFamily(token).post("/api/family/messages").send({ body: "hello" }).expect(201);

    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);

    const thread = await asFamily(token).get("/api/family/messages").expect(200);
    expect(thread.body.locked).toBe(true);

    // The family cannot reopen it...
    await asFamily(token)
      .post("/api/family/messages")
      .send({ body: "one more thing" })
      .expect(409);

    // ...and neither can the home. A thread only one side can reopen is not
    // closed, and the lock exists to protect the director.
    await staff.agent
      .post(`/api/cases/${row.id}/messages`)
      .send({ body: "actually..." })
      .expect(409);
  });

  it("records that a message was written out of hours without holding it", async () => {
    const staff = await signUpHome();

    // A home that is never open, so anything sent now is out of hours.
    await staff.agent
      .put("/api/home")
      .send({ officeOpensMinute: 1, officeClosesMinute: 2 })
      .expect(200);

    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const sent = await asFamily(token)
      .post("/api/family/messages")
      .send({ body: "Is it too late to add a hymn?" })
      .expect(201);

    // Delivered, and honestly flagged.
    expect(sent.body.sentOutsideOfficeHours).toBe(true);

    const inbox = await staff.agent.get(`/api/cases/${row.id}/messages`).expect(200);
    expect(inbox.body.messages).toHaveLength(1);
    expect(inbox.body.withinOfficeHours).toBe(false);
  });
});

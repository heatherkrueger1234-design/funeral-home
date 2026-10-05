import { afterEach, describe, expect, it, vi } from "vitest";
import { composeObituary, datePhrase, looksLikeDate, placePhrase } from "../src/lib/obituary";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

// The text provider, stood in for: no request leaves the test run.
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  class RateLimitError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    messages = {
      create: vi.fn(async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Margaret Hale, a teacher, died in Denver." }],
      })),
    };
  }
  return { default: Anthropic };
});

const blank = {
  fullName: null,
  pronouns: null,
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

describe("the obituary composer's grammar", () => {
  it("writes the showcase obituary the audit caught glued together", () => {
    const text = composeObituary({
      ...blank,
      fullName: "Margaret Ellen Whitfield",
      pronouns: "she",
      bornOn: "19 March 1941",
      birthPlace: "Pueblo, Colorado",
      // What the family typed, in the boxes they typed it into.
      diedOn: "at home in Denver",
      deathPlace: "Denver, Colorado",
      specialThanks: "To the district nurses, who were kind to her.",
      inLieuOfFlowers: "Donations to the Denver Public Library Friends.",
    });

    expect(text).toContain("Margaret Ellen Whitfield died at home in Denver.");
    expect(text).toContain("She was born on 19 March 1941 in Pueblo, Colorado.");
    expect(text).toContain("The family wishes to thank the district nurses, who were kind to her.");
    expect(text).toContain(
      "In lieu of flowers, donations may be made to the Denver Public Library Friends.",
    );
    expect(text).not.toMatch(/died on at|at Denver|They were born|thank To/);
  });

  it("uses the family's pronoun, or the first name when none was chosen", () => {
    const base = { ...blank, fullName: "Samuel Ray Ortiz", bornOn: "1950", diedOn: "May 2, 2026" };
    expect(composeObituary({ ...base, pronouns: "he" })).toContain("He was born in 1950");
    expect(composeObituary({ ...base, pronouns: "they" })).toContain("They were born in 1950");
    expect(composeObituary({ ...base, pronouns: "they", survivedBy: "their sister" })).toContain(
      "They are survived by their sister.",
    );
    expect(composeObituary({ ...base, survivedBy: "his wife" })).toContain(
      "Samuel is survived by his wife.",
    );
    // Before anybody has died (a pre-need file), the name leads.
    expect(composeObituary({ ...base, diedOn: null })).toBe("Samuel Ray Ortiz was born in 1950.");
  });

  it("chooses on, in and at the way an obituary does", () => {
    expect(datePhrase("19 March 1941")).toBe("on 19 March 1941");
    expect(datePhrase("September 3, 2026")).toBe("on September 3, 2026");
    expect(datePhrase("1941")).toBe("in 1941");
    expect(datePhrase("March 1941")).toBe("in March 1941");
    expect(datePhrase("spring of 1931")).toBe("in the spring of 1931");
    expect(placePhrase("Denver, Colorado")).toBe("in Denver, Colorado");
    expect(placePhrase("Saint Joseph Hospital")).toBe("at Saint Joseph Hospital");
    expect(placePhrase("at home in Denver")).toBe("at home in Denver");
    expect(looksLikeDate("at home in Denver")).toBe(false);
    expect(looksLikeDate("the spring after the war")).toBe(true);
  });

  it("puts the comma after a US date when a place follows", () => {
    expect(
      composeObituary({
        ...blank,
        fullName: "John Smith",
        diedOn: "September 3, 2026",
        deathPlace: "Denver Hospice",
      }),
    ).toBe("John Smith died on September 3, 2026, at Denver Hospice.");
  });

  it("strips the lead-ins a family types that the sentence already has", () => {
    const text = composeObituary({
      ...blank,
      survivedBy: "Survived by Her daughters",
      precededBy: "Preceded in death by her husband",
      specialThanks: "Thank you to Dr Lee",
      inLieuOfFlowers: "In lieu of flowers, gifts to the RSPCA",
      pronouns: "she",
    });
    expect(text).toContain("She is survived by her daughters.");
    expect(text).toContain("She was preceded in death by her husband.");
    expect(text).toContain("The family wishes to thank Dr Lee.");
    expect(text).toContain("In lieu of flowers, gifts may be made to the RSPCA.");
  });

  it("keeps the life story's own paragraphs and words", () => {
    const biography = "Peggy taught.\n\nShe grew tomatoes she insisted were better than they were.";
    expect(composeObituary({ ...blank, biography })).toBe(biography);
  });
});

describe("the obituary as the two sides see it", () => {
  afterEach(() => {
    delete process.env["ANTHROPIC_API_KEY"];
    vi.restoreAllMocks();
  });

  it("stores the family's pronoun and says when a date box holds a place", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id, { email: "anne@example.com" });

    const saved = await asFamily(token)
      .put("/api/family/obituary")
      .send({ pronouns: "she", diedOn: "at home in Denver" })
      .expect(200);
    expect(saved.body.pronouns).toBe("she");
    expect(saved.body.hints.diedOn).toMatch(/place/);

    await asFamily(token).put("/api/family/obituary").send({ pronouns: "it" }).expect(400);
  });

  it("keeps suggestions off without a key, and never shows one to the family", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id, { email: "anne@example.com" });

    const draft = await staff.agent.get(`/api/cases/${row.id}/obituary`).expect(200);
    expect(draft.body.aiAvailable).toBe(false);

    await staff.agent
      .post(`/api/cases/${row.id}/obituary/suggestion`)
      .send({ confirm: true })
      .expect(409);

    // With a key, nothing is sent without the director's confirmation.
    process.env["ANTHROPIC_API_KEY"] = "sk-test";
    await staff.agent
      .post(`/api/cases/${row.id}/obituary/suggestion`)
      .send({})
      .expect(400);

    const family = await asFamily(token).get("/api/family/obituary").expect(200);
    expect(family.body).not.toHaveProperty("aiSuggestion");
    expect(family.body).not.toHaveProperty("aiAvailable");
  });

  it("keeps a suggestion beside the draft until the director takes it", async () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-test";
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id, { email: "anne@example.com" });
    await asFamily(token)
      .put("/api/family/obituary")
      .send({ fullName: "Margaret Hale", biography: "She taught." })
      .expect(200);

    const suggested = await staff.agent
      .post(`/api/cases/${row.id}/obituary/suggestion`)
      .send({ confirm: true })
      .expect(200);
    expect(suggested.body.aiSuggestion).toContain("Margaret Hale");
    expect(suggested.body.draftText).toBeNull();

    const family = await asFamily(token).get("/api/family/obituary").expect(200);
    expect(JSON.stringify(family.body)).not.toContain("a teacher, died");

    const taken = await staff.agent
      .post(`/api/cases/${row.id}/obituary/suggestion/accept`)
      .expect(200);
    expect(taken.body.draftText).toBe("Margaret Hale, a teacher, died in Denver.");
    expect(taken.body.draftEditedByStaff).not.toBeNull();
    expect(taken.body.aiSuggestion).toBeNull();
  });
});

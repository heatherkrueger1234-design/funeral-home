import request from "supertest";
import { describe, expect, it, afterAll } from "vitest";
import { app, closeDatabase, useCleanDatabase } from "./helpers";
import { GUIDE_CHAPTERS } from "../src/lib/guide-index";

/**
 * Search runs with no OPENAI_API_KEY in the test environment, which is
 * deliberate: the keyword path is the one that has to work when the model is
 * unavailable, unaffordable or slow, and it is the path a bereaved parent
 * actually depends on. These cases exercise it.
 */

afterAll(closeDatabase);

async function search(query: string) {
  const res = await request(app)
    .post("/api/guides/search")
    .send({ query })
    .expect(200);
  return res.body as { crisis: boolean; usedModel: boolean; chapterIds: string[] };
}

describe("searching the guides", () => {
  useCleanDatabase();

  it("works without an account, like the guides themselves", async () => {
    const result = await search("autopsy");
    expect(result.chapterIds).toContain("autopsy");
  });

  it("finds the right chapter for how somebody would actually ask", async () => {
    const cases: [string, string][] = [
      ["can I see him after the autopsy", "autopsy"],
      ["do I have to embalm", "embalming"],
      ["lock of hair", "closing-fast"],
      ["cheapest cremation", "cheapest"],
      ["can I bury him on my land", "home-funeral"],
      ["hospital never gave me his clothes", "belongings-from-the-hospital"],
      ["how many children do you have", "how-many-children"],
      ["I can't sleep", "the-body"],
      ["the lights keep flickering", "signs"],
      ["medical bills keep arriving", "medical-bills"],
      ["how much time off work", "leave-from-work"],
      ["reporters keep calling", "reporters"],
      ["what do I say to my friend", "what-to-say"],
    ];

    for (const [query, expected] of cases) {
      const result = await search(query);
      expect(
        result.chapterIds,
        `"${query}" should surface ${expected}, got ${result.chapterIds.join(", ") || "nothing"}`,
      ).toContain(expected);
    }
  });

  it("answers a question that is really a person in trouble with the crisis chapter", async () => {
    for (const query of [
      "I want to die",
      "I can't do this anymore",
      "I don't want to be here",
    ]) {
      const result = await search(query);
      expect(result.crisis).toBe(true);
      expect(result.chapterIds).toEqual(["not-wanting-to-be-here"]);
      expect(result.usedModel).toBe(false);
    }
  });

  it("does not treat describing how they died as a crisis", async () => {
    const result = await search("my son died by suicide, the obituary");
    expect(result.crisis).toBe(false);
  });

  it("says plainly when the model was not used", async () => {
    // No OPENAI_API_KEY here, so this is the keyword path every time.
    const result = await search("autopsy report");
    expect(result.usedModel).toBe(false);
  });

  it("returns nothing rather than nonsense for a query that matches nothing", async () => {
    const result = await search("qwertyuiop zxcvbnm");
    expect(result.chapterIds).toEqual([]);
  });

  it("refuses an empty query", async () => {
    await request(app).post("/api/guides/search").send({ query: "   " }).expect(400);
  });

  it("only ever names chapters that exist", async () => {
    const known = new Set(GUIDE_CHAPTERS.map((c) => c.id));
    for (const query of ["autopsy", "money", "signs", "work", "children"]) {
      for (const id of (await search(query)).chapterIds) {
        expect(known.has(id), `${id} is not a real chapter`).toBe(true);
      }
    }
  });

  it("has a catalogue with no duplicate ids and a page for every chapter", async () => {
    const ids = GUIDE_CHAPTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const chapter of GUIDE_CHAPTERS) {
      expect(chapter.page.startsWith("/"), chapter.id).toBe(true);
      expect(chapter.title.length).toBeGreaterThan(0);
      expect(chapter.summary.length).toBeGreaterThan(0);
    }
  });
});

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, lifeChaptersTable, ageInYear } from "@workspace/db";
import {
  asFamily,
  createCase,
  inviteFamily,
  signUpHome,
  PNG_BYTES,
  type StaffSession,
} from "./helpers";

/**
 * A whole life in the book: the story from birth, the day itself, the
 * eulogies, and the photographs in the order they were taken.
 *
 * The thing being tested throughout is that none of it is mandatory and
 * none of it reshuffles what a family already arranged. Every section is a
 * switch that defaults on and prints nothing when empty, and the age
 * progression only happens once somebody types a year.
 */

async function bookCase(staff: StaffSession) {
  const row = await createCase(staff, {
    dateOfBirth: "1938-04-02",
    dateOfDeath: "2026-01-19",
    serviceAt: "2026-02-03T17:00:00.000Z",
    serviceLocation: "St Mary's, Pueblo",
  });
  const { token } = await inviteFamily(staff, row.id, {
    name: "Anne Hale",
    email: "anne@example.com",
  });
  const family = asFamily(token);

  /** Upload a photograph and return its id. */
  async function upload(caption: string) {
    const res = await family
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "p.png")
      .expect(201);
    await staff.agent
      .patch(`/api/photos/${res.body.id}`)
      .send({ caption })
      .expect(200);
    return res.body.id as number;
  }

  return { row, family, upload };
}

describe("the life story", () => {
  it("prints chapters in the order they happened, not the order they arrived", async () => {
    const staff = await signUpHome();
    const { row, family } = await bookCase(staff);

    // Written by three relatives over nine months, in no order at all.
    await family
      .post("/api/family/memory-book/chapters")
      .send({ title: "Riverside Elementary", body: "Thirty years of it.", startYear: 1961, endYear: 1990 })
      .expect(201);
    await family
      .post("/api/family/memory-book/chapters")
      .send({ title: "Born in Pueblo", body: "At home on Cedar Street.", startYear: 1938 })
      .expect(201);
    await staff.agent
      .post(`/api/cases/${row.id}/memory-book/chapters`)
      .send({ title: "Married", startYear: 1959 })
      .expect(201);

    const html = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    /*
     * The decade is the one thing six relatives already agree on, so the
     * year sorts and `position` is only a tiebreak. This is the opposite
     * of everywhere else in the schema and it is the point of the table.
     */
    const order = ["Born in Pueblo", "Married", "Riverside Elementary"].map((t) =>
      html.text.indexOf(t),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    // A span prints as one, a moment prints as a year.
    expect(html.text).toContain("1961–1990");
    expect(html.text).toContain("1938");
  });

  it("sorts an undated chapter to the end, not the beginning", async () => {
    const staff = await signUpHome();
    const { row, family } = await bookCase(staff);

    await family
      .post("/api/family/memory-book/chapters")
      .send({ title: "The bees", body: "Nobody remembers when she stopped." })
      .expect(201);
    await family
      .post("/api/family/memory-book/chapters")
      .send({ title: "Born in Pueblo", startYear: 1938 })
      .expect(201);

    const html = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    // An unplaced note about the bees is a footnote, not a prologue.
    expect(html.text.indexOf("Born in Pueblo")).toBeLessThan(
      html.text.indexOf("The bees"),
    );
  });

  it("refuses a chapter with nothing in it, and one that ends before it starts", async () => {
    const staff = await signUpHome();
    const { family } = await bookCase(staff);

    await family.post("/api/family/memory-book/chapters").send({}).expect(400);
    await family
      .post("/api/family/memory-book/chapters")
      .send({ title: "Backwards", startYear: 1990, endYear: 1961 })
      .expect(400);
  });

  it("does not let one relative overwrite another's account", async () => {
    const staff = await signUpHome();
    const { row, family } = await bookCase(staff);

    const mine = await family
      .post("/api/family/memory-book/chapters")
      .send({ title: "Born in Pueblo", startYear: 1938 })
      .expect(201);

    const { token } = await inviteFamily(staff, row.id, { name: "Bill Hale" });

    /*
     * Two relatives will inevitably disagree about a date. They can settle
     * it by adding a chapter or by telling the home, which can edit
     * anything. What is not allowed is one of them silently rewriting the
     * other's account of their mother's life.
     */
    await asFamily(token)
      .put(`/api/family/memory-book/chapters/${mine.body.id}`)
      .send({ startYear: 1939 })
      .expect(404);

    await staff.agent
      .put(`/api/cases/${row.id}/memory-book/chapters/${mine.body.id}`)
      .send({ startYear: 1939 })
      .expect(200);
  });

  it("is not signed in the printed book", async () => {
    const staff = await signUpHome();
    const { row, family } = await bookCase(staff);

    await family
      .post("/api/family/memory-book/chapters")
      .send({ title: "Born in Pueblo", body: "At home on Cedar Street.", startYear: 1938 })
      .expect(201);

    const html = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    /*
     * The life story reads as the family's, in one voice, because that is
     * what it is. A chapter about somebody's birth signed by whichever
     * cousin happened to type it would be strange.
     */
    expect(html.text).toContain("Cedar Street");
    const lifeSection = html.text.slice(
      html.text.indexOf("Her life"),
      html.text.indexOf("Cedar Street") + 200,
    );
    expect(lifeSection).not.toContain("Anne Hale");

    // But the home can still see who wrote it.
    const book = await staff.agent
      .get(`/api/cases/${row.id}/memory-book`)
      .expect(200);
    expect(book.body.chapters[0].authorName).toBe("Anne Hale");
  });
});

describe("the photographs, in the order they were taken", () => {
  it("captions a dated photograph with the year and how old she was", async () => {
    const staff = await signUpHome();
    const { row, upload } = await bookCase(staff);

    const p = await upload("Skegness");
    await staff.agent.patch(`/api/photos/${p}`).send({ takenYear: 1974 }).expect(200);
    await staff.agent
      .put(`/api/cases/${row.id}/photos/selection`)
      .send({ photoIds: [p] })
      .expect(200);

    const html = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    // Born 1938, taken 1974. The caption a family wants and cannot work
    // out forty times over.
    expect(html.text).toContain("1974 · aged 36");
  });

  it("runs dated photographs oldest first and leaves undated ones where they were", async () => {
    const staff = await signUpHome();
    const { row, upload } = await bookCase(staff);

    const young = await upload("A child");
    const old = await upload("Her eightieth");
    const undated = await upload("Nobody knows");

    await staff.agent.patch(`/api/photos/${old}`).send({ takenYear: 2018 }).expect(200);
    await staff.agent.patch(`/api/photos/${young}`).send({ takenYear: 1946 }).expect(200);

    // Selected in the wrong order on purpose.
    await staff.agent
      .put(`/api/cases/${row.id}/photos/selection`)
      .send({ photoIds: [old, undated, young] })
      .expect(200);

    const html = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    const at = (s: string) => html.text.indexOf(s);
    expect(at("A child")).toBeLessThan(at("Her eightieth"));
    // Undated goes to the back: a loose photograph is a loose end.
    expect(at("Her eightieth")).toBeLessThan(at("Nobody knows"));
  });

  it("leaves an undated book in exactly the order the family arranged it", async () => {
    const staff = await signUpHome();
    const { row, upload } = await bookCase(staff);

    const a = await upload("First");
    const b = await upload("Second");
    const c = await upload("Third");

    await staff.agent
      .put(`/api/cases/${row.id}/photos/selection`)
      .send({ photoIds: [c, a, b] })
      .expect(200);

    const html = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    /*
     * The progression is something a home opts into by typing years, never
     * something that silently reshuffles a family's arrangement.
     */
    const at = (s: string) => html.text.indexOf(s);
    expect(at("Third")).toBeLessThan(at("First"));
    expect(at("First")).toBeLessThan(at("Second"));
  });

  it("keeps photographs of the funeral out of the life and puts them at the back", async () => {
    const staff = await signUpHome();
    const { row, upload } = await bookCase(staff);

    const life = await upload("Skegness");
    const day = await upload("The chapel, full");

    await staff.agent.patch(`/api/photos/${life}`).send({ takenYear: 1974 }).expect(200);
    await staff.agent
      .patch(`/api/photos/${day}`)
      .send({ takenAtService: true })
      .expect(200);
    await staff.agent
      .put(`/api/cases/${row.id}/photos/selection`)
      .send({ photoIds: [life, day] })
      .expect(200);

    const html = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    /*
     * A photograph of the chapel full of people is the most recent picture
     * on the case, and sorting it into a progression of childhood pictures
     * on that basis would be exactly wrong.
     */
    expect(html.text.indexOf("Skegness")).toBeLessThan(
      html.text.indexOf("The chapel, full"),
    );
    expect(html.text).toContain("The day");
    expect(html.text.indexOf("The day")).toBeLessThan(
      html.text.indexOf("The chapel, full"),
    );
  });

  it("works out an age only when it can, and never a silly one", () => {
    const born = new Date("1938-04-02T00:00:00.000Z");

    expect(ageInYear(born, 1974)).toBe(36);
    expect(ageInYear(null, 1974)).toBeNull();
    expect(ageInYear(born, null)).toBeNull();
    // A mistyped year prints nothing rather than "aged 964".
    expect(ageInYear(born, 1074)).toBeNull();
    expect(ageInYear(born, 2900)).toBeNull();
  });
});

describe("the celebration of life", () => {
  it("prints the day from the case and whatever the home added", async () => {
    const staff = await signUpHome();
    const { row } = await bookCase(staff);

    await staff.agent
      .put(`/api/cases/${row.id}/memory-book`)
      .send({
        serviceOrder: "Welcome\nThe 23rd Psalm\nEulogy, by her son",
        music: "Amazing Grace, sung by the grandchildren",
        bearers: "Bill, Tom, and four of her former pupils",
        reception: "The parish hall, and there was far too much cake.",
      })
      .expect(200);

    const html = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    expect(html.text).toContain("A celebration of her life");
    expect(html.text).toContain("St Mary's, Pueblo");
    expect(html.text).toContain("Amazing Grace");
    expect(html.text).toContain("far too much cake");
    /*
     * The date off the case, not retyped — and in the home's own timezone.
     * A service at 11am in Pueblo that printed as 6pm because the server
     * runs on UTC would be a false statement about the day, in the one
     * document a family still has in thirty years.
     */
    expect(html.text).toContain("February 3, 2026");
    expect(html.text).toContain("10:00 AM");
  });

  it("prints no page at all when nobody filled any of it in", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const html = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    // An empty section prints nothing rather than a heading over a blank
    // page — which is what lets every switch default to on.
    expect(html.text).not.toContain("A celebration of her life");
  });
});

describe("eulogies", () => {
  it("prints what somebody read, with their name, before the memories", async () => {
    const staff = await signUpHome();
    const { row, family } = await bookCase(staff);

    await family
      .post("/api/family/memory-book/entries")
      .send({ body: "She answered the telephone as though it were an emergency." })
      .expect(201);

    await family
      .post("/api/family/memory-book/entries")
      .send({
        kind: "eulogy",
        body: "My mother taught four hundred children to read.\n\n".repeat(60),
      })
      .expect(201);

    const html = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    expect(html.text).toContain("Read by Anne Hale");
    // A eulogy belongs with the day; a memory belongs with the others.
    expect(html.text.indexOf("Eulogies")).toBeLessThan(
      html.text.indexOf("Memories"),
    );
  });

  it("lets a eulogy be long and still holds a memory to a paragraph", async () => {
    const staff = await signUpHome();
    const { family } = await bookCase(staff);

    const long = "word ".repeat(1500); // ~7,500 characters

    // Fine as a eulogy...
    await family
      .post("/api/family/memory-book/entries")
      .send({ kind: "eulogy", body: long })
      .expect(201);

    // ...and refused as a memory, with a message that says what to do.
    const refused = await family
      .post("/api/family/memory-book/entries")
      .send({ body: long })
      .expect(400);

    expect(JSON.stringify(refused.body)).toMatch(/eulogy/i);
  });
});

describe("turning sections off", () => {
  it("prints a plain photograph album when the home asks for one", async () => {
    const staff = await signUpHome();
    const { row, family, upload } = await bookCase(staff);

    await family
      .post("/api/family/memory-book/chapters")
      .send({ title: "Born in Pueblo", startYear: 1938 })
      .expect(201);
    await family
      .post("/api/family/memory-book/entries")
      .send({ kind: "eulogy", body: "What I read at the service." })
      .expect(201);
    const day = await upload("The chapel, full");
    await staff.agent.patch(`/api/photos/${day}`).send({ takenAtService: true }).expect(200);
    await staff.agent
      .put(`/api/cases/${row.id}/photos/selection`)
      .send({ photoIds: [day] })
      .expect(200);
    await staff.agent
      .put(`/api/cases/${row.id}/memory-book`)
      .send({ serviceOrder: "Welcome" })
      .expect(200);

    const full = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);
    expect(full.text).toContain("Her life");
    expect(full.text).toContain("Eulogies");
    expect(full.text).toContain("A celebration of her life");
    expect(full.text).toContain("The chapel, full");

    await staff.agent
      .put(`/api/cases/${row.id}/memory-book`)
      .send({
        includeLifeStory: false,
        includeEulogies: false,
        includeCelebration: false,
        includeServicePhotos: false,
      })
      .expect(200);

    const plain = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    expect(plain.text).not.toContain("Her life");
    expect(plain.text).not.toContain("Eulogies");
    expect(plain.text).not.toContain("A celebration of her life");
    expect(plain.text).not.toContain("The chapel, full");
  });
});

describe("erasing the case", () => {
  it("takes the life story with it", async () => {
    const staff = await signUpHome();
    const { row, family } = await bookCase(staff);

    await family
      .post("/api/family/memory-book/chapters")
      .send({ title: "Born in Pueblo", startYear: 1938 })
      .expect(201);

    await staff.agent
      .post(`/api/cases/${row.id}/delete`)
      .send({ confirmName: "Margaret Hale", reason: "The family asked." })
      .expect(204);

    expect(
      await db.select().from(lifeChaptersTable).where(eq(lifeChaptersTable.caseId, row.id)),
    ).toHaveLength(0);
  });
});

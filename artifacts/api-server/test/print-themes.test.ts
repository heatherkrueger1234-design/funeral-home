import { describe, expect, it } from "vitest";
import { PRINT_THEMES } from "../src/lib/print-themes";
import { createCase, signUpHome } from "./helpers";

/**
 * The looks a card can take, and the programme's obituary page.
 */
describe("print themes", () => {
  it("offers several designed looks, Classic first", async () => {
    const staff = await signUpHome();
    const res = await staff.agent.get("/api/print/themes").expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(6);
    expect(res.body[0].key).toBe("classic");
    expect(new Set(res.body.map((t: { key: string }) => t.key)).size).toBe(res.body.length);
    // Every theme draws with its own type, not all Georgia.
    expect(new Set(PRINT_THEMES.map((t) => t.headingFont)).size).toBeGreaterThanOrEqual(4);
  });

  it("renders a card in the chosen theme, and refuses one that does not exist", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card", themeKey: "heritage" })
      .expect(201);
    expect(item.body.themeKey).toBe("heritage");

    const html = (await staff.agent.get(`/api/print/${item.body.id}/render`).expect(200)).text;
    expect(html).toContain("Garamond");
    expect(html).toContain("--accent: #7a5b2e");
    expect(html).toContain('class="ornament"');

    await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ themeKey: "comic-sans" })
      .expect(400);

    const garden = await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ themeKey: "garden" })
      .expect(200);
    expect(garden.body.themeKey).toBe("garden");
  });

  it("does not change the look of a card the family already approved", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "bookmark" })
      .expect(201);
    await staff.agent.put(`/api/print/${item.body.id}`).send({ status: "approved" }).expect(200);
    await staff.agent.put(`/api/print/${item.body.id}`).send({ themeKey: "modern" }).expect(409);
  });
});

describe("the obituary in print", () => {
  async function caseWithObituary() {
    const staff = await signUpHome();
    const row = await createCase(staff);
    await staff.agent
      .put(`/api/cases/${row.id}/obituary`)
      .send({
        fullName: "Margaret Ellen Hale",
        pronouns: "she",
        bornOn: "19 March 1941",
        birthPlace: "Pueblo, Colorado",
        biography: "Peggy taught school for thirty years.\n\nShe grew tomatoes.",
      })
      .expect(200);
    await staff.agent.post(`/api/cases/${row.id}/obituary/compose`).expect(200);
    return { staff, row };
  }

  it("puts the obituary on the programme's inside page", async () => {
    const { staff, row } = await caseWithObituary();
    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "program-folded" })
      .expect(201);
    expect(item.body.resolved.obituary).toContain("Peggy taught school");

    const html = (await staff.agent.get(`/api/print/${item.body.id}/render`).expect(200)).text;
    expect(html).toContain("In Loving Memory");
    expect(html).toContain("was born on 19 March 1941 in Pueblo, Colorado.</p>");
    expect(html).toContain("<p>She grew tomatoes.</p>");
  });

  it("prints the obituary on a page of its own", async () => {
    const { staff, row } = await caseWithObituary();
    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "obituary-page", themeKey: "evening" })
      .expect(201);
    const html = (await staff.agent.get(`/api/print/${item.body.id}/render`).expect(200)).text;
    expect(html).toContain('class="obituary"');
    expect(html).toContain("Peggy taught school for thirty years.");
    expect(html).toContain("Didot");
  });

  it("keeps the old inside page when there is no obituary", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "program-folded" })
      .expect(201);
    await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ values: { bearers: "Tom\nDick" } })
      .expect(200);
    const html = (await staff.agent.get(`/api/print/${item.body.id}/render`).expect(200)).text;
    expect(html).not.toContain("In Loving Memory");
    expect(html).toContain("Pallbearers");
  });
});

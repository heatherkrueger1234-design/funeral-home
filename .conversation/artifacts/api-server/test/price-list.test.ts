import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/**
 * The test that matters most in this file is the one that asserts an absence.
 *
 * A home's prices are staff-only, and staff-only is not a preference here:
 * the FTC Funeral Rule governs how a funeral provider discloses prices, and a
 * national SaaS that quietly published a home's numbers off a text box would
 * be handing that home a compliance problem in fifty states. The guarantee is
 * that no family route and no public route reads `home_price_items`.
 *
 * That guarantee is invisible in the shape of any handler -- it is the
 * absence of a line -- which is exactly the kind of thing that rots when
 * somebody helpfully folds prices into the family's session six months from
 * now. So it is asserted here, over the whole surface rather than over one
 * endpoint.
 */

async function homeWithPrices() {
  const staff = await signUpHome();

  await staff.agent
    .post("/api/home/price-list")
    .send({
      category: "Services",
      label: "Graveside service",
      amountCents: 249500,
      note: "plus cemetery charges",
    })
    .expect(201);

  await staff.agent
    .post("/api/home/price-list")
    .send({ category: "Flowers", label: "Casket spray", note: "at market" })
    .expect(201);

  return staff;
}

describe("the home's own price sheet", () => {
  it("formats the money once, on the server", async () => {
    const staff = await homeWithPrices();

    const res = await staff.agent.get("/api/home/price-list").expect(200);
    const graveside = res.body.find(
      (row: { label: string }) => row.label === "Graveside service",
    );

    expect(graveside.amountCents).toBe(249500);
    expect(graveside.amountLabel).toBe("$2,495.00");
  });

  it("keeps a line that genuinely has no number", async () => {
    const staff = await homeWithPrices();

    const res = await staff.agent.get("/api/home/price-list").expect(200);
    const spray = res.body.find(
      (row: { label: string }) => row.label === "Casket spray",
    );

    // Forcing a zero here would have the home writing down something false.
    expect(spray.amountCents).toBeNull();
    expect(spray.amountLabel).toBeNull();
    expect(spray.note).toBe("at market");
  });

  it("is reachable by any signed-in colleague, not only the owner", async () => {
    // A price that is wrong at a kitchen table has to be fixable at the
    // kitchen table, by whoever is sitting there.
    const staff = await homeWithPrices();

    await staff.agent
      .post("/api/home/staff")
      .send({ email: "arranger@example.com", displayName: "Ruth" })
      .expect(201);

    const res = await staff.agent.get("/api/home/price-list").expect(200);
    expect(res.body.length).toBe(2);
  });
});

describe("prices never leave the office", () => {
  it("is not in anything a family's link can reach", async () => {
    const staff = await homeWithPrices();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id as number);

    /*
     * Every read the family surface offers. If a future handler folds prices
     * into one of these, this fails -- which is the point of listing them all
     * rather than checking the session alone.
     */
    const paths = [
      "/api/family/session",
      "/api/family/photos",
      "/api/family/obituary",
      "/api/family/selections",
      "/api/family/belongings",
      "/api/family/preparation",
      "/api/family/vitals",
      "/api/family/messages",
      "/api/family/deadlines",
      "/api/family/print",
      "/api/family/service-offers",
    ];

    for (const path of paths) {
      const res = await asFamily(family.token).get(path).expect(200);
      const body = JSON.stringify(res.body);

      expect(body, `${path} leaked a price`).not.toContain("249500");
      expect(body, `${path} leaked a price`).not.toContain("2,495.00");
      expect(body, `${path} leaked a price`).not.toContain("Graveside service");
    }

    // And a link token is not a staff session: the route is behind the
    // cookie gate, so it answers 401 rather than an empty list.
    await asFamily(family.token).get("/api/home/price-list").expect(401);
  });

  it("is not on the home's public page", async () => {
    const staff = await homeWithPrices();
    const home = await staff.agent.get("/api/home").expect(200);

    const res = await request(app)
      .get(`/api/public/homes/${home.body.slug}`)
      .expect(200);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain("249500");
    expect(body).not.toContain("Graveside service");
  });

  it("is not reachable by another home", async () => {
    const staff = await homeWithPrices();
    const mine = await staff.agent.get("/api/home/price-list").expect(200);

    const stranger = await signUpHome("Elm Street Chapel");

    const theirs = await stranger.agent.get("/api/home/price-list").expect(200);
    expect(theirs.body).toHaveLength(0);

    await stranger.agent
      .put(`/api/price-items/${mine.body[0].id}`)
      .send({ amountCents: 1 })
      .expect(404);
    await stranger.agent
      .delete(`/api/price-items/${mine.body[0].id}`)
      .expect(404);
  });

  it("is refused to a stranger with no credential at all", async () => {
    await request(app).get("/api/home/price-list").expect(401);
  });
});

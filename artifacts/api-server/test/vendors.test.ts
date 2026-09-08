import { describe, expect, it, beforeAll } from "vitest";
import { db, postalCodesTable } from "@workspace/db";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/**
 * Proximity has to be real miles, not a ZIP prefix comparison, or a family in
 * Denver gets recommended a monument company in Boulder ahead of one four
 * streets away. These use genuine Census centroids.
 */
const ZIPS = [
  { code: "80202", latitude: 39.749556, longitude: -104.994178 }, // Denver
  { code: "80301", latitude: 40.03078, longitude: -105.24632 }, // Boulder ~23mi
  { code: "80904", latitude: 38.85321, longitude: -104.85105 }, // Colo Spgs ~62mi
  { code: "10001", latitude: 40.750638, longitude: -73.997498 }, // NYC ~1628mi
];

beforeAll(async () => {
  // The suite truncates domain tables but not reference data; seeding the
  // handful used here keeps the test independent of the loader script.
  await db.insert(postalCodesTable).values(ZIPS).onConflictDoNothing();
});

describe("finding local help", () => {
  it("ranks by actual distance from the ZIP given", async () => {
    const staff = await signUpHome();

    for (const [name, postalCode] of [
      ["Far Monuments", "10001"],
      ["Near Monuments", "80202"],
      ["Middling Monuments", "80301"],
    ] as const) {
      await staff.agent
        .post("/api/vendors")
        .send({ kind: "monument", name, postalCode })
        .expect(201);
    }

    const list = await staff.agent
      .get("/api/vendors?kind=monument&near=80202")
      .expect(200);

    expect(list.body.map((v: { name: string }) => v.name)).toEqual([
      "Near Monuments",
      "Middling Monuments",
      "Far Monuments",
    ]);

    // Real miles, not a rank.
    expect(list.body[0].distanceMiles).toBe(0);
    expect(list.body[1].distanceMiles).toBeGreaterThan(20);
    expect(list.body[1].distanceMiles).toBeLessThan(26);
    expect(list.body[2].distanceMiles).toBeGreaterThan(1500);
  });

  it("puts the home's own recommendation first regardless of distance", async () => {
    const staff = await signUpHome();

    await staff.agent
      .post("/api/vendors")
      .send({ kind: "monument", name: "Nearest", postalCode: "80202" })
      .expect(201);

    await staff.agent
      .post("/api/vendors")
      .send({
        kind: "monument",
        name: "The one we trust",
        postalCode: "80904",
        preferred: true,
      })
      .expect(201);

    const list = await staff.agent
      .get("/api/vendors?kind=monument&near=80202")
      .expect(200);

    expect(list.body[0].name).toBe("The one we trust");
  });

  it("filters by radius but never hides one it could not place", async () => {
    const staff = await signUpHome();

    await staff.agent
      .post("/api/vendors")
      .send({ kind: "cemetery", name: "Local Rest", postalCode: "80202" })
      .expect(201);
    await staff.agent
      .post("/api/vendors")
      .send({ kind: "cemetery", name: "Distant Rest", postalCode: "10001" })
      .expect(201);
    // A mistyped ZIP: the director needs to see it to fix it.
    await staff.agent
      .post("/api/vendors")
      .send({ kind: "cemetery", name: "Unplaced Rest", postalCode: "00000" })
      .expect(201);

    const list = await staff.agent
      .get("/api/vendors?kind=cemetery&near=80202&radiusMiles=50")
      .expect(200);

    const names = list.body.map((v: { name: string }) => v.name);
    expect(names).toContain("Local Rest");
    expect(names).toContain("Unplaced Rest");
    expect(names).not.toContain("Distant Rest");

    const unplaced = list.body.find(
      (v: { name: string }) => v.name === "Unplaced Rest",
    );
    expect(unplaced.distanceMiles).toBeNull();
  });

  it("does not offer live lookup as though it had searched", async () => {
    const staff = await signUpHome();

    // No provider key in the test environment. The honest answer is that
    // nothing is connected, not that there is nothing nearby.
    const result = await staff.agent
      .get("/api/vendors/lookup?kind=monument&near=80202")
      .expect(200);

    expect(result.body.configured).toBe(false);
    expect(result.body.results).toEqual([]);
    expect(result.body.message).toBeTruthy();
  });

  it("rejects a ZIP it cannot place, rather than returning nothing", async () => {
    const staff = await signUpHome();
    await staff.agent
      .get("/api/vendors/lookup?kind=monument&near=99999")
      .expect(400);
  });
});

describe("what a family sees", () => {
  it("shows only what the home has chosen to show, near their own ZIP", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    await staff.agent
      .post("/api/vendors")
      .send({
        kind: "monument",
        name: "Shown To Families",
        postalCode: "80202",
        visibleToFamily: true,
      })
      .expect(201);

    await staff.agent
      .post("/api/vendors")
      .send({ kind: "monument", name: "Internal Only", postalCode: "80202" })
      .expect(201);

    // The family says where they are — once, on the screen that needs it.
    const located = await asFamily(token)
      .put("/api/family/postal-code")
      .send({ postalCode: "80301" })
      .expect(200);
    expect(located.body.recognised).toBe(true);

    const list = await asFamily(token).get("/api/family/vendors").expect(200);

    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe("Shown To Families");
    // Measured from the family's ZIP, not the home's.
    expect(list.body[0].distanceMiles).toBeGreaterThan(20);
  });

  it("says plainly when a ZIP is not one we know", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const result = await asFamily(token)
      .put("/api/family/postal-code")
      .send({ postalCode: "99999" })
      .expect(200);

    expect(result.body.postalCode).toBe("99999");
    expect(result.body.recognised).toBe(false);
  });

  it("passes a quote request through the home and records the answer", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id, { name: "Anne Hale" });

    const vendor = await staff.agent
      .post("/api/vendors")
      .send({
        kind: "monument",
        name: "Granite & Sons",
        postalCode: "80202",
        visibleToFamily: true,
      })
      .expect(201);

    const asked = await asFamily(token)
      .post("/api/family/quotes")
      .send({
        vendorId: vendor.body.id,
        request: "A double headstone, room for my father later.",
      })
      .expect(201);

    expect(asked.body.status).toBe("requested");
    expect(asked.body.requestedByName).toBe("Anne Hale");
    expect(asked.body.vendorName).toBe("Granite & Sons");

    // The home records what came back, in the vendor's own terms.
    const answered = await staff.agent
      .put(`/api/quotes/${asked.body.id}`)
      .send({
        status: "quoted",
        quotedAmountCents: 285000,
        response: "Granite, double, 8-10 weeks.",
      })
      .expect(200);

    expect(answered.body.quotedAmountCents).toBe(285000);
    expect(answered.body.respondedAt).not.toBeNull();

    // And the family can compare it without a phone call.
    const seen = await asFamily(token).get("/api/family/quotes").expect(200);
    expect(seen.body[0].quotedAmountCents).toBe(285000);
  });

  it("will not let a family ask about a vendor the home hides", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const hidden = await staff.agent
      .post("/api/vendors")
      .send({ kind: "monument", name: "Internal Only", postalCode: "80202" })
      .expect(201);

    await asFamily(token)
      .post("/api/family/quotes")
      .send({ vendorId: hidden.body.id })
      .expect(404);
  });
});

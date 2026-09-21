import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, funeralHomesTable } from "@workspace/db";
import { asFamily, createCase, inviteFamily, signUpHome, PNG_BYTES } from "./helpers";

/**
 * The test that asserts an absence, and the reason it is written down.
 *
 * There is an obvious next revenue line in this product and somebody
 * proposes it about once a quarter: the software has already written the
 * obituary and already assembled the slideshow out of the family's own
 * photographs, the family is right there, and they would almost certainly
 * pay twenty dollars for a keepsake copy. It converts. It is a second
 * revenue line off a case we are already serving. Every argument for it is
 * a real argument.
 *
 * It is still wrong, for four reasons set out at length in
 * `schema/plans.ts`: it puts us back in the money-transmission and PCI
 * business the architecture deliberately left; the charge would appear
 * inside the home's branded portal without appearing on the home's General
 * Price List or its Statement of Funeral Goods and Services Selected, which
 * is the home's Funeral Rule problem and not ours to create for them;
 * C.R.S. 6-1-101 says the number the family sees first is the number they
 * pay; and the slideshow is made of photographs of their own mother, which
 * they uploaded, so a fee to get it back is a toll rather than an upsell.
 *
 * None of that is visible in the shape of any handler. It is the absence of
 * a route, which is exactly the kind of guarantee that rots the first time
 * somebody helpfully adds one. So it is asserted here, over the whole
 * surface rather than over any single endpoint.
 */

const familySource = readFileSync(
  fileURLToPath(new URL("../src/routes/family.ts", import.meta.url)),
  "utf8",
);
const publicSource = readFileSync(
  fileURLToPath(new URL("../src/routes/public.ts", import.meta.url)),
  "utf8",
);

describe("the family is never charged", () => {
  it("keeps the money code out of the family and public surfaces entirely", () => {
    /*
     * Asserted against the source rather than against behaviour, because
     * the first symptom of this going wrong is an import, months before
     * there is a route to call. `price-list.test.ts` guards the same
     * boundary from the other direction -- what a family may *read* -- and
     * this one guards what a family may be *asked for*.
     */
    for (const [name, source] of [
      ["family.ts", familySource],
      ["public.ts", publicSource],
    ] as const) {
      expect(source, `${name} must not reach the billing code`).not.toMatch(
        /from "\.\.\/lib\/(billing|metering)"/,
      );
      expect(source, `${name} must not talk to Stripe`).not.toMatch(/stripe/i);
      expect(
        source,
        `${name} must not mint a checkout of any kind`,
      ).not.toMatch(/checkout|paymentIntent|payment_intent/i);
    }
  });

  it("gives the family their obituary and their photographs for nothing", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    await family
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "mother.png")
      .expect(201);

    const obituary = await family.get("/api/family/obituary").expect(200);
    const photos = await family.get("/api/family/photos").expect(200);

    expect(photos.body).toHaveLength(1);

    /*
     * Not a payment wall, not a watermark, not a "preview". The absence of
     * any of those is the product promise, so it is checked as a shape
     * rather than trusted: nothing the family is handed may carry a price,
     * a total, or a way to pay one.
     */
    for (const body of [obituary.body, photos.body]) {
      const serialised = JSON.stringify(body);
      expect(serialised).not.toMatch(/amountCents|priceCents|checkoutUrl/);
      expect(serialised).not.toMatch(/"(price|total|amount|fee)"\s*:/i);
    }
  });

  it("still gives them everything after the home has stopped paying", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    await family
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "mother.png")
      .expect(201);

    // The home cancels, drops every add-on, and is suspended by the
    // platform for good measure.
    await db
      .update(funeralHomesTable)
      .set({
        subscriptionStatus: "canceled",
        trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        entitlements: "",
        suspendedAt: new Date(),
        suspendedReason: "Non-payment",
      })
      .where(eq(funeralHomesTable.id, staff.homeId));

    /*
     * A family part-way through arranging their mother's funeral is not a
     * party to our billing dispute with the funeral home, and their
     * photographs are not our leverage in it.
     */
    await family.get("/api/family/session").expect(200);
    await family.get("/api/family/obituary").expect(200);
    const photos = await family.get("/api/family/photos").expect(200);
    expect(photos.body).toHaveLength(1);

    await family
      .put("/api/family/obituary")
      .send({ biography: "Margaret was born in Pueblo." })
      .expect(200);
  });

  it("refuses a family token at every route that could take money", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    /*
     * The billing surface is mounted below the staff session gate, so a
     * family link token is not a credential there. Checked from outside
     * rather than by reading the mount order, because the mount order is
     * the thing that would look right on the day it was wrong.
     */
    for (const path of ["/api/billing", "/api/billing/checkout", "/api/billing/portal"]) {
      const res = await family.get(path);
      expect([401, 403, 404]).toContain(res.status);
    }

    await family
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://example.com" })
      .expect((res) => {
        expect([401, 403, 404]).toContain(res.status);
      });

    /*
     * And there is no family-side equivalent under their own prefix. An
     * unmatched path below `/api/family` falls through to the staff session
     * gate, so 401 and 404 are both "there is nothing here"; what would
     * fail this test is a 200.
     */
    for (const path of [
      "/api/family/billing",
      "/api/family/checkout",
      "/api/family/obituary/purchase",
      "/api/family/photo-pack/purchase",
    ]) {
      const read = await family.get(path);
      expect([401, 404]).toContain(read.status);

      const write = await family.post(path).send({});
      expect([401, 404]).toContain(write.status);
    }
  });
});

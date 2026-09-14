import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/**
 * The storefront, and the four things about it that are not negotiable.
 *
 * Most of what follows is ordinary: load a catalogue, browse it, choose
 * something, print a statement. Four of these tests are about what must
 * *not* happen, and they are the reason this file is long:
 *
 *  - a family sees no casket until they have the General Price List;
 *  - declining anything changes the total, including inside a package;
 *  - a family bringing their own urn is charged nothing, and there is
 *    nowhere for a fee to be put even by a client that tries;
 *  - a pre-need case is offered no way to pay, in the API or the interface,
 *    and nothing in this component moves money at all.
 */

/**
 * A price sheet shaped like one a home would actually have.
 *
 * Note the cost column. It sits where it sits in every supplier's export,
 * right beside the retail price, and importing it would publish a home's
 * margin on the price list it hands a family.
 */
const PRICE_SHEET = [
  "Category,Item Name,Description,Price,Item Code,Cost",
  'Our Services,Basic services of funeral director and staff,"Available to families at any hour",2195,SVC-1,',
  "Our Services,Transfer of remains to our care,Within 25 miles,395,SVC-2,",
  'Caskets,Windsor 18 Gauge Steel,"Silver finish, rosetan crepe interior","$2,495.00",CSK-100,1100.00',
  "Caskets,Poplar Hardwood,Satin-finished poplar,1895,CSK-101,900",
  "Burial Vaults,Standard Concrete Vault,,1195,OBC-1,",
  "Cremation Urns,Brushed Pewter,A simple pewter urn,295.50,URN-10,120",
  "Cremation Urns,Hand-thrown Stoneware,,,URN-11,",
  ",,,,,",
].join("\r\n");

async function loadedHome(name?: string) {
  const staff = await signUpHome(name);

  await staff.agent
    .post("/api/catalogue/import")
    .attach("file", Buffer.from(PRICE_SHEET, "utf8"), "prices.csv")
    .expect(200);

  return staff;
}

/** A home with a dated General Price List, which is what turns it all on. */
async function tradingHome(name?: string) {
  const staff = await loadedHome(name);

  await staff.agent
    .put("/api/storefront/settings")
    .send({
      gplEffectiveOn: "2026-01-01",
      disclosures: {
        right_to_select:
          "You may choose only the items you want. We will tell you the price of anything you are required to buy.",
      },
      priceListFootnote: "Prices are subject to change without notice.",
    })
    .expect(200);

  return staff;
}

async function catalogueOf(staff: Awaited<ReturnType<typeof signUpHome>>) {
  const res = await staff.agent.get("/api/catalogue").expect(200);
  return res.body as {
    hasGeneralPriceList: boolean;
    categories: {
      id: number;
      name: string;
      section: string;
      items: { id: number; name: string; priceCents: number }[];
    }[];
    packages: { id: number; name: string; priceCents: number }[];
  };
}

function findItem(
  catalogue: Awaited<ReturnType<typeof catalogueOf>>,
  name: string,
) {
  for (const category of catalogue.categories) {
    const item = category.items.find((row) => row.name === name);
    if (item) return item;
  }
  throw new Error(`No catalogue item called "${name}"`);
}

describe("the storefront ships empty", () => {
  it("gives a new home no merchandise, no prices and no price list", async () => {
    const staff = await signUpHome();

    const catalogue = await catalogueOf(staff);

    expect(catalogue.categories).toEqual([]);
    expect(catalogue.packages).toEqual([]);
    expect(catalogue.hasGeneralPriceList).toBe(false);

    const settings = await staff.agent.get("/api/storefront/settings").expect(200);

    expect(settings.body.gplEffectiveOn).toBeNull();
    expect(settings.body.paymentPageUrl).toBeNull();
    expect(settings.body.disclosures).toEqual({});
  });

  it("refuses to print a price list it has nothing to put on", async () => {
    const staff = await signUpHome();

    const res = await staff.agent
      .get("/api/catalogue/price-lists/gpl/render")
      .expect(400);

    expect(res.body.error).toMatch(/nothing in your catalogue/i);
  });
});

describe("loading a catalogue from a spreadsheet", () => {
  it("guesses the columns, the sections and what would change", async () => {
    const staff = await signUpHome();

    const res = await staff.agent
      .post("/api/catalogue/import/preview")
      .attach("file", Buffer.from(PRICE_SHEET, "utf8"), "prices.csv")
      .expect(200);

    expect(res.body.mapping.name).toBe("Item Name");
    expect(res.body.mapping.priceCents).toBe("Price");
    expect(res.body.mapping.itemCode).toBe("Item Code");

    const sections = Object.fromEntries(
      res.body.categories.map((row: { name: string; section: string }) => [
        row.name,
        row.section,
      ]),
    );

    expect(sections).toEqual({
      "Our Services": "services",
      Caskets: "caskets",
      "Burial Vaults": "outer_burial_containers",
      "Cremation Urns": "merchandise",
    });

    expect(res.body.wouldCreate).toBe(6);
    expect(res.body.wouldUpdate).toBe(0);
    expect(res.body.issues).toEqual([
      {
        row: 8,
        message: expect.stringContaining("Hand-thrown Stoneware"),
      },
    ]);
  });

  it("never reads a cost column as a price", async () => {
    const staff = await loadedHome();
    const catalogue = await catalogueOf(staff);

    // $1,100.00 is what the home pays for the Windsor. $2,495.00 is what it
    // charges. Importing the wrong one publishes the home's margin.
    expect(findItem(catalogue, "Windsor 18 Gauge Steel").priceCents).toBe(249500);
    expect(findItem(catalogue, "Brushed Pewter").priceCents).toBe(29550);
  });

  it("updates on a second import rather than doubling the catalogue", async () => {
    const staff = await loadedHome();

    const raised = PRICE_SHEET.replace('"$2,495.00"', "2695.00");

    const res = await staff.agent
      .post("/api/catalogue/import")
      .attach("file", Buffer.from(raised, "utf8"), "prices.csv")
      .expect(200);

    expect(res.body.created).toBe(0);
    expect(res.body.updated).toBe(6);

    const catalogue = await catalogueOf(staff);
    const all = catalogue.categories.flatMap((category) => category.items);

    expect(all).toHaveLength(6);
    expect(findItem(catalogue, "Windsor 18 Gauge Steel").priceCents).toBe(269500);
  });

  it("lets the director correct a section we guessed wrong", async () => {
    const staff = await signUpHome();

    await staff.agent
      .post("/api/catalogue/import")
      .field("sections", JSON.stringify({ "Cremation Urns": "caskets" }))
      .attach("file", Buffer.from(PRICE_SHEET, "utf8"), "prices.csv")
      .expect(200);

    const catalogue = await catalogueOf(staff);
    const urns = catalogue.categories.find((row) => row.name === "Cremation Urns");

    expect(urns?.section).toBe("caskets");
  });

  it("refuses a file with no price column rather than importing nothing", async () => {
    const staff = await signUpHome();

    const res = await staff.agent
      .post("/api/catalogue/import")
      .attach(
        "file",
        Buffer.from("Category,Item Name\nUrns,Pewter\n", "utf8"),
        "prices.csv",
      )
      .expect(400);

    expect(res.body.error).toMatch(/price column/i);
  });
});

describe("the three statutory price lists", () => {
  it("prints a General Price List with every section on it", async () => {
    const staff = await tradingHome();

    const res = await staff.agent
      .get("/api/catalogue/price-lists/gpl/render")
      .expect(200);

    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("General Price List");
    expect(res.text).toContain("Windsor 18 Gauge Steel");
    expect(res.text).toContain("Standard Concrete Vault");
    expect(res.text).toContain("Basic services of funeral director and staff");
    expect(res.text).toContain("$2,495.00");
    expect(res.text).toContain("Effective January 1, 2026");
    // The home's own disclosure wording, and only the slots it has written.
    expect(res.text).toContain("You may choose only the items you want.");
    expect(res.text).toContain("Prices are subject to change");
  });

  it("prints a Casket Price List of caskets and nothing else", async () => {
    const staff = await tradingHome();

    const res = await staff.agent
      .get("/api/catalogue/price-lists/cpl/render")
      .expect(200);

    expect(res.text).toContain("Casket Price List");
    expect(res.text).toContain("Windsor 18 Gauge Steel");
    expect(res.text).toContain("Poplar Hardwood");
    expect(res.text).not.toContain("Standard Concrete Vault");
    expect(res.text).not.toContain("Brushed Pewter");
  });

  it("prints an Outer Burial Container Price List", async () => {
    const staff = await tradingHome();

    const res = await staff.agent
      .get("/api/catalogue/price-lists/obcpl/render")
      .expect(200);

    expect(res.text).toContain("Outer Burial Container Price List");
    expect(res.text).toContain("Standard Concrete Vault");
    expect(res.text).not.toContain("Windsor 18 Gauge Steel");
  });

  it("escapes a home's own wording rather than rendering it as markup", async () => {
    const staff = await tradingHome();

    await staff.agent
      .put("/api/storefront/settings")
      .send({ priceListFootnote: "<script>alert('x')</script> Ask us." })
      .expect(200);

    const res = await staff.agent
      .get("/api/catalogue/price-lists/gpl/render")
      .expect(200);

    expect(res.text).not.toContain("<script>alert");
    expect(res.text).toContain("&lt;script&gt;");
  });
});

describe("a family is shown no casket before the General Price List", () => {
  it("hides caskets and vaults until the price list has been opened", async () => {
    const staff = await tradingHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    const before = await family.get("/api/family/storefront").expect(200);

    expect(before.body.casketsUnlocked).toBe(false);
    expect(before.body.categories.map((c: { name: string }) => c.name)).toEqual([
      "Our Services",
      "Cremation Urns",
    ]);

    await family
      .get("/api/family/storefront/price-lists/gpl/render")
      .expect(200);

    const after = await family.get("/api/family/storefront").expect(200);

    expect(after.body.casketsUnlocked).toBe(true);
    expect(after.body.categories.map((c: { name: string }) => c.name)).toEqual([
      "Our Services",
      "Caskets",
      "Burial Vaults",
      "Cremation Urns",
    ]);
  });

  it("refuses a casket on the selection until then, however it is asked for", async () => {
    const staff = await tradingHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    const casket = findItem(await catalogueOf(staff), "Windsor 18 Gauge Steel");

    const refused = await family
      .post("/api/family/storefront/items")
      .send({ itemId: casket.id })
      .expect(400);

    expect(refused.body.error).toMatch(/General Price List/i);

    // And the Casket Price List itself is behind the same gate.
    await family
      .get("/api/family/storefront/price-lists/cpl/render")
      .expect(400);

    await family.get("/api/family/storefront/price-lists/gpl/render").expect(200);

    await family
      .post("/api/family/storefront/items")
      .send({ itemId: casket.id })
      .expect(201);
  });

  it("counts a director handing one across the desk as the same thing", async () => {
    const staff = await tradingHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    await staff.agent
      .post(`/api/cases/${row.id}/selection/gpl-given`)
      .expect(200);

    const res = await asFamily(token).get("/api/family/storefront").expect(200);
    expect(res.body.casketsUnlocked).toBe(true);
  });

  it("shows no casket at all when the home has never dated a price list", async () => {
    const staff = await loadedHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    const res = await family.get("/api/family/storefront").expect(200);

    expect(res.body.hasGeneralPriceList).toBe(false);
    expect(res.body.casketsUnlocked).toBe(false);
    expect(JSON.stringify(res.body.categories)).not.toContain("Windsor");
  });
});

describe("declining an item changes the total", () => {
  it("adds, removes, and moves the total both times", async () => {
    const staff = await tradingHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    const catalogue = await catalogueOf(staff);
    const services = findItem(catalogue, "Basic services of funeral director and staff");
    const urn = findItem(catalogue, "Brushed Pewter");

    await family
      .post("/api/family/storefront/items")
      .send({ itemId: services.id })
      .expect(201);

    const both = await family
      .post("/api/family/storefront/items")
      .send({ itemId: urn.id })
      .expect(201);

    expect(both.body.totalCents).toBe(219500 + 29550);

    const urnLine = both.body.lines.find(
      (line: { name: string }) => line.name === "Brushed Pewter",
    );

    const declined = await family
      .delete(`/api/family/storefront/items/${urnLine.id}`)
      .expect(200);

    expect(declined.body.totalCents).toBe(219500);
    expect(declined.body.lines).toHaveLength(1);
  });

  it("lets a package be broken, and keeps every price itemised when it is", async () => {
    const staff = await tradingHome();
    const catalogue = await catalogueOf(staff);
    const services = findItem(catalogue, "Basic services of funeral director and staff");
    const transfer = findItem(catalogue, "Transfer of remains to our care");

    const pack = await staff.agent
      .post("/api/catalogue/packages")
      .send({
        name: "Traditional Service",
        priceCents: 239000,
        itemIds: [services.id, transfer.id],
      })
      .expect(201);

    // The itemised total is always alongside the package price, never
    // instead of it — a package that is the only price on offer is the
    // thing the Funeral Rule actually forbids.
    expect(pack.body.itemisedTotalCents).toBe(219500 + 39500);
    expect(pack.body.priceCents).toBe(239000);

    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    const chosen = await family
      .post("/api/family/storefront/packages")
      .send({ packageId: pack.body.id })
      .expect(201);

    // Three lines: both items at their own prices, and the adjustment.
    expect(chosen.body.lines).toHaveLength(3);
    expect(chosen.body.lines[0].unitPriceCents).toBe(219500);
    expect(chosen.body.lines[1].unitPriceCents).toBe(39500);
    expect(chosen.body.lines[2].kind).toBe("package_adjustment");
    expect(chosen.body.totalCents).toBe(239000);

    const broken = await family
      .delete(`/api/family/storefront/items/${chosen.body.lines[1].id}`)
      .expect(200);

    // The set is broken, so the package price goes with it and what is left
    // stands at its own price.
    expect(broken.body.lines).toHaveLength(1);
    expect(broken.body.totalCents).toBe(219500);
  });

  it("keeps a withdrawn package's link to what a family already chose", async () => {
    const staff = await tradingHome();
    const catalogue = await catalogueOf(staff);
    const services = findItem(catalogue, "Basic services of funeral director and staff");
    const transfer = findItem(catalogue, "Transfer of remains to our care");

    const pack = await staff.agent
      .post("/api/catalogue/packages")
      .send({
        name: "Traditional Service",
        priceCents: 239000,
        itemIds: [services.id, transfer.id],
      })
      .expect(201);

    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    const chosen = await family
      .post("/api/family/storefront/packages")
      .send({ packageId: pack.body.id })
      .expect(201);

    // The home stops offering it while this family is still deciding.
    const withdrawn = await staff.agent
      .delete(`/api/catalogue/packages/${pack.body.id}`)
      .expect(200);

    expect(withdrawn.body).toEqual({ archived: true });

    const unchanged = await family.get("/api/family/storefront").expect(200);
    expect(unchanged.body.packages).toEqual([]);
    expect(unchanged.body.selection.totalCents).toBe(239000);

    // And breaking the set still takes the package price with it. Hard
    // deleting the package would have severed that link and left the family
    // holding a discount for a set they no longer have.
    const broken = await family
      .delete(`/api/family/storefront/items/${chosen.body.lines[1].id}`)
      .expect(200);

    expect(broken.body.lines).toHaveLength(1);
    expect(broken.body.totalCents).toBe(219500);
  });
});

describe("bringing your own", () => {
  it("records it with no price, and no way to give it one", async () => {
    const staff = await tradingHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    const added = await family
      .post("/api/family/storefront/family-provided")
      .send({
        name: "Her mother's urn",
        notes: "Her sister is bringing it on Thursday.",
      })
      .expect(201);

    const line = added.body.lines[0];

    expect(line.kind).toBe("family_provided");
    expect(line.unitPriceCents).toBeNull();
    expect(line.lineTotalCents).toBe(0);
    expect(added.body.totalCents).toBe(0);

    // A client that tries to attach a fee is refused outright rather than
    // having the field quietly ignored.
    await family
      .post("/api/family/storefront/family-provided")
      .send({ name: "Their own casket", unitPriceCents: 9500 })
      .expect(400);

    await family
      .post("/api/family/storefront/family-provided")
      .send({ name: "Their own casket", priceCents: 9500 })
      .expect(400);
  });

  it("prints on the statement as no charge", async () => {
    const staff = await tradingHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    await asFamily(token)
      .post("/api/family/storefront/family-provided")
      .send({ name: "Her mother's urn" })
      .expect(201);

    const res = await staff.agent
      .get(`/api/cases/${row.id}/statement/render`)
      .expect(200);

    expect(res.text).toContain("Her mother's urn");
    expect(res.text).toContain("No charge");
    expect(res.text).not.toMatch(/handling/i);
  });
});

describe("the Statement of Funeral Goods and Services Selected", () => {
  it("is itemised, totalled, and printable by both sides", async () => {
    const staff = await tradingHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    const catalogue = await catalogueOf(staff);

    await family
      .post("/api/family/storefront/items")
      .send({
        itemId: findItem(catalogue, "Basic services of funeral director and staff").id,
      })
      .expect(201);

    await family
      .post("/api/family/storefront/items")
      .send({ itemId: findItem(catalogue, "Brushed Pewter").id, quantity: 2 })
      .expect(201);

    await staff.agent
      .put(`/api/cases/${row.id}/selection`)
      .send({ confirmed: true, notes: "Agreed at the arrangement conference." })
      .expect(200);

    const printed = await staff.agent
      .get(`/api/cases/${row.id}/statement/render`)
      .expect(200);

    expect(printed.text).toContain(
      "Statement of Funeral Goods and Services Selected",
    );
    expect(printed.text).toContain("Margaret Hale");
    expect(printed.text).toContain("$2,195.00");
    expect(printed.text).toContain("× 2");
    expect(printed.text).toContain("$591.00");
    expect(printed.text).toContain("$2,786.00");
    expect(printed.text).toContain("at the prices effective January 1, 2026");

    const familyCopy = await family
      .get("/api/family/storefront/statement/render")
      .expect(200);

    expect(familyCopy.text).toContain("$2,786.00");
  });

  it("carries the legal name, with what they were called beside it", async () => {
    const staff = await tradingHome();
    const row = await createCase(staff, {
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
      decedentPreferredName: "Peggy",
    });

    const urn = findItem(await catalogueOf(staff), "Brushed Pewter");

    await staff.agent
      .post(`/api/cases/${row.id}/selection/items`)
      .send({ itemId: urn.id })
      .expect(201);

    const printed = await staff.agent
      .get(`/api/cases/${row.id}/statement/render`)
      .expect(200);

    // Read beside a death certificate and an insurance claim, so the legal
    // name leads even though every other screen says "Peggy".
    expect(printed.text).toContain("Margaret Hale (Peggy)");
  });

  it("stops taking changes once the director has agreed it", async () => {
    const staff = await tradingHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    const urn = findItem(await catalogueOf(staff), "Brushed Pewter");

    await family
      .post("/api/family/storefront/items")
      .send({ itemId: urn.id })
      .expect(201);

    await staff.agent
      .put(`/api/cases/${row.id}/selection`)
      .send({ confirmed: true })
      .expect(200);

    const refused = await family
      .post("/api/family/storefront/items")
      .send({ itemId: urn.id })
      .expect(400);

    expect(refused.body.error).toMatch(/reopen/i);

    // A director can reopen it, which is the one way back.
    await staff.agent
      .put(`/api/cases/${row.id}/selection`)
      .send({ confirmed: false })
      .expect(200);

    await family
      .post("/api/family/storefront/items")
      .send({ itemId: urn.id })
      .expect(201);
  });

  it("keeps what a family agreed when the home raises its prices", async () => {
    const staff = await tradingHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const urn = findItem(await catalogueOf(staff), "Brushed Pewter");

    await asFamily(token)
      .post("/api/family/storefront/items")
      .send({ itemId: urn.id })
      .expect(201);

    await staff.agent
      .put(`/api/catalogue/items/${urn.id}`)
      .send({ priceCents: 49900 })
      .expect(200);

    const res = await staff.agent.get(`/api/cases/${row.id}/selection`).expect(200);

    expect(res.body.selection.totalCents).toBe(29550);
  });

  it("points at the home's own payment page, with the destination shown", async () => {
    const staff = await tradingHome();

    await staff.agent
      .put("/api/storefront/settings")
      .send({
        paymentPageUrl: "https://pay.horanandmcconaty.com/invoice",
        paymentInstructions: "Or post a check to the office, made out to us.",
      })
      .expect(200);

    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    const urn = findItem(await catalogueOf(staff), "Brushed Pewter");

    await family
      .post("/api/family/storefront/items")
      .send({ itemId: urn.id })
      .expect(201);

    // Nothing about paying is shown while the arrangement is still a draft.
    const draft = await family.get("/api/family/storefront").expect(200);
    expect(draft.body.payment).toBeNull();

    await staff.agent
      .put(`/api/cases/${row.id}/selection`)
      .send({ confirmed: true })
      .expect(200);

    const confirmed = await family.get("/api/family/storefront").expect(200);

    expect(confirmed.body.payment.url).toBe(
      "https://pay.horanandmcconaty.com/invoice",
    );
    expect(confirmed.body.payment.host).toBe("pay.horanandmcconaty.com");

    const printed = await family
      .get("/api/family/storefront/statement/render")
      .expect(200);

    expect(printed.text).toContain("pay.horanandmcconaty.com");
    expect(printed.text).toContain("post a check");
  });

  it("refuses a payment page that is not https", async () => {
    const staff = await tradingHome();

    await staff.agent
      .put("/api/storefront/settings")
      .send({ paymentPageUrl: "http://pay.example.com" })
      .expect(400);
  });

  it("gives the telephone number rather than an error when there is no link", async () => {
    const staff = await tradingHome();

    await staff.agent.put("/api/home").send({ phone: "(303) 555-0134" }).expect(200);

    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    const urn = findItem(await catalogueOf(staff), "Brushed Pewter");

    await family
      .post("/api/family/storefront/items")
      .send({ itemId: urn.id })
      .expect(201);

    await staff.agent
      .put(`/api/cases/${row.id}/selection`)
      .send({ confirmed: true })
      .expect(200);

    const printed = await family
      .get("/api/family/storefront/statement/render")
      .expect(200);

    expect(printed.text).toContain("(303) 555-0134");
    expect(printed.text).toMatch(/telephone/i);
  });
});

describe("a pre-need case is never offered a way to pay", () => {
  it("offers no payment path in the API", async () => {
    const staff = await tradingHome();
    const row = await createCase(staff, { kind: "pre_need" });
    const { token } = await inviteFamily(staff, row.id);
    const family = asFamily(token);

    const urn = findItem(await catalogueOf(staff), "Brushed Pewter");

    await staff.agent
      .put("/api/storefront/settings")
      .send({ paymentPageUrl: "https://pay.example.com/invoice" })
      .expect(200);

    await family
      .post("/api/family/storefront/items")
      .send({ itemId: urn.id })
      .expect(201);

    await staff.agent
      .put(`/api/cases/${row.id}/selection`)
      .send({ confirmed: true })
      .expect(200);

    const res = await family.get("/api/family/storefront").expect(200);

    expect(res.body.mayDiscussPayment).toBe(false);
    expect(res.body.payment).toBeNull();
    // Not merely absent from one field: nowhere in the whole payload.
    expect(JSON.stringify(res.body)).not.toContain("pay.example.com");

    // And a director cannot mark a plan settled, because nothing is owed.
    const refused = await staff.agent
      .put(`/api/cases/${row.id}/selection`)
      .send({ settled: true })
      .expect(400);

    expect(refused.body.error).toMatch(/plan, not a bill/i);
  });

  it("prints a plan rather than a bill", async () => {
    const staff = await tradingHome();
    const row = await createCase(staff, {
      kind: "pre_need",
      decedentFirstName: "Eleanor",
      decedentLastName: "Vance",
    });

    await staff.agent
      .put("/api/storefront/settings")
      .send({ paymentPageUrl: "https://pay.example.com/invoice" })
      .expect(200);

    const urn = findItem(await catalogueOf(staff), "Brushed Pewter");

    await staff.agent
      .post(`/api/cases/${row.id}/selection/items`)
      .send({ itemId: urn.id })
      .expect(201);

    await staff.agent
      .put(`/api/cases/${row.id}/selection`)
      .send({ confirmed: true })
      .expect(200);

    const printed = await staff.agent
      .get(`/api/cases/${row.id}/statement/render`)
      .expect(200);

    expect(printed.text).toContain("This is a plan, not a bill");
    expect(printed.text).not.toContain("pay.example.com");
  });
});

describe("no code path in this component moves money", () => {
  /**
   * A test about an absence, which is the only way to keep one.
   *
   * Everything else here would still pass if somebody added a Stripe call,
   * a card field or a stored balance to the storefront next spring. This
   * reads the component's own source and fails if one appears. The single
   * payment integration in this codebase is us charging a home its monthly
   * subscription, in `billing.ts`, and it is not reachable from any file
   * named below.
   */
  const OWNED_FILES = [
    "../src/routes/catalogue.ts",
    "../src/routes/orders.ts",
    "../src/lib/storefront.ts",
    "../src/lib/catalogue-import.ts",
    "../src/lib/price-list-render.ts",
  ];

  const FORBIDDEN = [
    /\bstripe\b/i,
    /payment[_-]?intent/i,
    /\bcheckout\.session/i,
    /card[_-]?number/i,
    /\bcvv\b/i,
    /routing[_-]?number/i,
    /account[_-]?number/i,
    /\bcharge\(/i,
    /amount[_-]?(paid|received|captured)/i,
  ];

  it.each(OWNED_FILES)("%s takes no money", (relative) => {
    const source = readFileSync(
      fileURLToPath(new URL(relative, import.meta.url)),
      "utf8",
    );

    for (const pattern of FORBIDDEN) {
      expect(source).not.toMatch(pattern);
    }
  });

  it("stores no amount paid against a selection", async () => {
    const staff = await tradingHome();
    const row = await createCase(staff);

    const urn = findItem(await catalogueOf(staff), "Brushed Pewter");

    await staff.agent
      .post(`/api/cases/${row.id}/selection/items`)
      .send({ itemId: urn.id })
      .expect(201);

    const settled = await staff.agent
      .put(`/api/cases/${row.id}/selection`)
      .send({
        confirmed: true,
        settled: true,
        settledNote: "Paid by check, 14 March.",
      })
      .expect(200);

    // A mark about the home's own books. Never an amount, never a receipt.
    const body = JSON.stringify(settled.body.selection);
    expect(settled.body.selection.settledAt).not.toBeNull();
    expect(body).not.toMatch(/amountPaid|balance|received/i);
  });
});

describe("one home's prices are not another's", () => {
  it("refuses every way across the tenant boundary", async () => {
    const mine = await tradingHome("Horan & McConaty");
    const theirs = await tradingHome("Olinger");

    const myItem = findItem(await catalogueOf(mine), "Brushed Pewter");
    const theirCase = await createCase(theirs);

    // Their catalogue does not contain my item id, so it is simply not found.
    await theirs.agent.put(`/api/catalogue/items/${myItem.id}`).send({ priceCents: 1 }).expect(404);
    await theirs.agent.delete(`/api/catalogue/items/${myItem.id}`).expect(404);

    // And my item cannot be put on their family's sheet.
    await theirs.agent
      .post(`/api/cases/${theirCase.id}/selection/items`)
      .send({ itemId: myItem.id })
      .expect(404);

    const myCase = await createCase(mine);
    await theirs.agent.get(`/api/cases/${myCase.id}/selection`).expect(404);
  });

  it("serves a catalogue photograph only to the home that owns it", async () => {
    const mine = await tradingHome("Horan & McConaty");
    const row = await createCase(mine);
    const { token } = await inviteFamily(mine, row.id);

    // An upload that belongs to nobody's catalogue is not reachable by a
    // family however they mangle the id.
    await asFamily(token).get("/api/family/storefront/uploads/1").expect(400);
  });
});

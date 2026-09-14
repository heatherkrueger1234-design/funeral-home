import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, casesTable } from "@workspace/db";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/**
 * The statement, and the fact that no money goes anywhere near it.
 *
 * Two of the groups below test for the absence of things, which is unusual
 * and is the point. "We take no payments" and "a pre-need case has no payment
 * path" are the two claims this component makes that would be most expensive
 * to discover were untrue, and a claim that only exists in a brief is one a
 * future feature walks straight through.
 */

const CASKET = {
  kind: "merchandise",
  description: "Cherry casket, half-couch",
  detail: "Ivory crepe interior",
  unitAmountCents: 289_500,
};

const SERVICE = {
  kind: "service",
  description: "Professional services of the funeral director and staff",
  unitAmountCents: 249_500,
};

async function draftFor(
  staff: Awaited<ReturnType<typeof signUpHome>>,
  caseId: number,
) {
  const res = await staff.agent
    .post(`/api/cases/${caseId}/statements`)
    .send({})
    .expect(201);

  return res.body as {
    id: number;
    status: string;
    version: number;
    lines: Array<{ id: number; description: string }>;
  };
}

describe("the statement of funeral goods and services selected", () => {
  it("adds up the lines the family actually chose", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const draft = await draftFor(staff, row.id);

    await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send(SERVICE)
      .expect(201);

    const res = await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send({ ...CASKET, quantity: 1 })
      .expect(201);

    expect(res.body.totalCents).toBe(249_500 + 289_500);
    expect(res.body.total).toBe("$5,390.00");
    expect(res.body.lines).toHaveLength(2);
    expect(res.body.lines[0].amount).toBe("$2,495.00");
  });

  it("multiplies by quantity and subtracts an allowance", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const draft = await draftFor(staff, row.id);

    await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send({
        kind: "cash_advance",
        description: "Certified copies of the death certificate",
        quantity: 8,
        unitAmountCents: 2_000,
        disclosure:
          "We charge you for our services in obtaining these copies.",
      })
      .expect(201);

    const res = await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send({
        kind: "allowance",
        description: "Veteran's allowance, applied by the home",
        unitAmountCents: 5_000,
      })
      .expect(201);

    expect(res.body.totalCents).toBe(8 * 2_000 - 5_000);
  });

  it("declining an item changes the total", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const draft = await draftFor(staff, row.id);

    await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send(SERVICE)
      .expect(201);

    const added = await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send(CASKET)
      .expect(201);

    const casketLine = added.body.lines.find(
      (line: { description: string }) => line.description === CASKET.description,
    );

    const after = await staff.agent
      .delete(`/api/statement-lines/${casketLine.id}`)
      .expect(200);

    expect(after.body.totalCents).toBe(249_500);
  });

  it("refuses to confirm an empty statement", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const draft = await draftFor(staff, row.id);

    await staff.agent
      .post(`/api/statements/${draft.id}/confirm`)
      .send({})
      .expect(400);
  });

  it("freezes a statement once it has been handed over", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const draft = await draftFor(staff, row.id);

    await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send(SERVICE)
      .expect(201);

    const confirmed = await staff.agent
      .post(`/api/statements/${draft.id}/confirm`)
      .send({})
      .expect(200);

    expect(confirmed.body.status).toBe("confirmed");
    expect(confirmed.body.confirmedAt).not.toBeNull();

    await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send(CASKET)
      .expect(400);

    const line = confirmed.body.lines[0];
    await staff.agent
      .put(`/api/statement-lines/${line.id}`)
      .send({ unitAmountCents: 1 })
      .expect(400);
  });

  it("carries a revision forward and supersedes the copy it replaces", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const first = await draftFor(staff, row.id);

    await staff.agent
      .post(`/api/statements/${first.id}/lines`)
      .send(SERVICE)
      .expect(201);
    await staff.agent
      .post(`/api/statements/${first.id}/confirm`)
      .send({})
      .expect(200);

    const second = await draftFor(staff, row.id);
    expect(second.version).toBe(2);
    // The revision starts from what was agreed, not from a blank page.
    expect(second.lines).toHaveLength(1);

    await staff.agent
      .post(`/api/statements/${second.id}/confirm`)
      .send({})
      .expect(200);

    const all = await staff.agent
      .get(`/api/cases/${row.id}/statements`)
      .expect(200);

    const byId = new Map(
      all.body.map((entry: { id: number; status: string }) => [
        entry.id,
        entry.status,
      ]),
    );

    expect(byId.get(first.id)).toBe("superseded");
    expect(byId.get(second.id)).toBe("confirmed");
  });

  it("prints a statement the family can keep", async () => {
    const staff = await signUpHome("Nightingale & Sons");
    const row = await createCase(staff);
    const draft = await draftFor(staff, row.id);

    await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send({
        kind: "merchandise",
        description: "Outer burial container",
        unitAmountCents: 119_500,
        disclosure:
          "Green Mountain Cemetery requires an outer burial container.",
      })
      .expect(201);
    await staff.agent
      .post(`/api/statements/${draft.id}/confirm`)
      .send({})
      .expect(200);

    const res = await staff.agent
      .get(`/api/statements/${draft.id}/print`)
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain(
      "Statement of Funeral Goods and Services Selected",
    );
    expect(res.text).toContain("Margaret Hale");
    expect(res.text).toContain("Nightingale &amp; Sons");
    expect(res.text).toContain("$1,195.00");
    // The Funeral Rule wants the requirement beside the item it justifies.
    expect(res.text).toContain("Green Mountain Cemetery requires");
    // The document belongs to the home. Our name is not on it.
    expect(res.text).not.toMatch(/holding today/i);
  });
});

describe("a casket or urn the family brought in", () => {
  it("cannot be given a price or a handling fee", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const draft = await draftFor(staff, row.id);

    await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send({
        kind: "family_provided",
        description: "Urn purchased by the family",
        unitAmountCents: 5_000,
      })
      .expect(400);

    const res = await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send({
        kind: "family_provided",
        description: "Urn purchased by the family",
      })
      .expect(201);

    expect(res.body.totalCents).toBe(0);
    expect(res.body.lines[0].amount).toBeNull();

    // And it cannot be given one afterwards either.
    await staff.agent
      .put(`/api/statement-lines/${res.body.lines[0].id}`)
      .send({ unitAmountCents: 5_000 })
      .expect(400);
  });
});

describe("the handoff to the home's own payment page", () => {
  it("keeps the home's link and shows the family where it goes", async () => {
    const staff = await signUpHome("Nightingale & Sons");

    const saved = await staff.agent
      .put("/api/payment-handoff")
      .send({
        paymentPageUrl: "https://www.nightingaleandsons.com/pay",
        otherWaysToPay: "Or bring a check to the office on Main Street.",
      })
      .expect(200);

    expect(saved.body.url).toBe("https://www.nightingaleandsons.com/pay");
    expect(saved.body.host).toBe("nightingaleandsons.com");

    const row = await createCase(staff);
    const draft = await draftFor(staff, row.id);
    await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send(SERVICE)
      .expect(201);
    await staff.agent
      .post(`/api/statements/${draft.id}/confirm`)
      .send({})
      .expect(200);

    const { token } = await inviteFamily(staff, row.id);
    const res = await asFamily(token).get("/api/family/statement").expect(200);

    expect(res.body.statement.total).toBe("$2,495.00");
    expect(res.body.payment.url).toBe("https://www.nightingaleandsons.com/pay");
    expect(res.body.payment.host).toBe("nightingaleandsons.com");
    expect(res.body.payment.otherWaysToPay).toContain("check");
  });

  it("lets only an owner change where the money goes", async () => {
    const owner = await signUpHome();

    const invited = await owner.agent
      .post("/api/home/staff")
      .send({ email: "helper@example.com", role: "staff" })
      .expect(201);

    const token = String(invited.body.inviteLink).split("token=")[1]!;
    const request = (await import("supertest")).default;
    const app = (await import("../src/app")).default;

    const agent = request.agent(app);
    await agent
      .post("/api/auth/reset-password")
      .send({ token: decodeURIComponent(token), password: "another-long-pass" })
      .expect(204);
    await agent
      .post("/api/auth/login")
      .send({ email: "helper@example.com", password: "another-long-pass" })
      .expect(200);

    // Swapping the payment link is the highest-value thing anybody could do
    // with a borrowed staff account, so it sits with the owner.
    await agent
      .put("/api/payment-handoff")
      .send({ paymentPageUrl: "https://not-the-home.example.com/pay" })
      .expect(400);

    await agent.get("/api/payment-handoff").expect(200);
  });

  it("refuses a link that is not a plain https address on a website", async () => {
    const staff = await signUpHome();

    for (const url of [
      "http://example.com/pay",
      "javascript:alert(1)",
      "https://user:secret@example.com/pay",
      "https://localhost/pay",
      "not a url at all",
    ]) {
      await staff.agent
        .put("/api/payment-handoff")
        .send({ paymentPageUrl: url })
        .expect(400);
    }
  });

  it("gives the family the telephone number when there is no link", async () => {
    const staff = await signUpHome();
    await staff.agent.put("/api/home").send({ phone: "(303) 555-0142" });

    const row = await createCase(staff);
    const draft = await draftFor(staff, row.id);
    await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send(SERVICE)
      .expect(201);
    await staff.agent
      .post(`/api/statements/${draft.id}/confirm`)
      .send({})
      .expect(200);

    const { token } = await inviteFamily(staff, row.id);
    const res = await asFamily(token).get("/api/family/statement").expect(200);

    expect(res.body.payment.url).toBeNull();
    expect(res.body.payment.phone).toBe("(303) 555-0142");
  });
});

describe("what the family is shown", () => {
  it("is nothing at all until the director confirms it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const draft = await draftFor(staff, row.id);

    await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send(SERVICE)
      .expect(201);

    const { token } = await inviteFamily(staff, row.id);
    const res = await asFamily(token).get("/api/family/statement").expect(200);

    // A draft total is a number that is not yet a number. The portal says the
    // director is still working rather than showing a figure that will move.
    expect(res.body.statement).toBeNull();
    expect(res.body.payment).toBeNull();
  });

  it("says the home marked it settled, and never that we did", async () => {
    const staff = await signUpHome("Nightingale & Sons");
    const row = await createCase(staff);
    const draft = await draftFor(staff, row.id);

    await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send(SERVICE)
      .expect(201);
    await staff.agent
      .post(`/api/statements/${draft.id}/confirm`)
      .send({})
      .expect(200);

    await staff.agent
      .post(`/api/statements/${draft.id}/settled`)
      .send({ note: "Check 4417, banked 14 March." })
      .expect(200);

    const printed = await staff.agent
      .get(`/api/statements/${draft.id}/print`)
      .expect(200);

    expect(printed.text).toContain(
      "recorded this as settled in their own records",
    );
    // Never a receipt from us: we do not process it and are not told about it.
    expect(printed.text).not.toMatch(/payment received|paid in full/i);

    const { token } = await inviteFamily(staff, row.id);
    const res = await asFamily(token).get("/api/family/statement").expect(200);
    expect(res.body.statement.settledAt).not.toBeNull();
    expect(res.body.statement.settledNote).toContain("Check 4417");
  });

  it("cannot see another home's statement", async () => {
    const ours = await signUpHome("Nightingale & Sons");
    const theirs = await signUpHome("Horan & McConaty");

    const theirCase = await createCase(theirs);
    const theirDraft = await draftFor(theirs, theirCase.id);

    await ours.agent.get(`/api/statements/${theirDraft.id}`).expect(404);
    await ours.agent
      .post(`/api/statements/${theirDraft.id}/lines`)
      .send(SERVICE)
      .expect(404);
    await ours.agent
      .post(`/api/statements/${theirDraft.id}/confirm`)
      .send({})
      .expect(404);
  });
});

/* ------------------------------------------------------------------------ */

describe("a pre-need case has no payment path", () => {
  /**
   * C.R.S. Title 10, Article 15. Selling a preneed funeral contract in
   * Colorado needs a Division of Insurance licence, a $500 filing fee,
   * $100,000 of net worth or a bond, and 85% of the money placed in trust —
   * or insurance funding instead. There is no third method. A total plus a
   * way to pay it, shown to somebody arranging their own funeral, is that
   * contract, so there is nothing here to show them.
   */
  it("offers no statement and no link in the API", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { kind: "pre_need" });

    await staff.agent.put("/api/payment-handoff").send({
      paymentPageUrl: "https://www.nightingaleandsons.com/pay",
    });

    const refused = await staff.agent
      .post(`/api/cases/${row.id}/statements`)
      .send({})
      .expect(400);

    expect(refused.body.error).toMatch(/pre-need/i);

    const { token } = await inviteFamily(staff, row.id);
    const res = await asFamily(token).get("/api/family/statement").expect(200);

    expect(res.body.statement).toBeNull();
    // The link is configured and the pre-need family is still not shown it.
    expect(res.body.payment).toBeNull();

    await asFamily(token).get("/api/family/statement/print").expect(400);
  });

  /**
   * The guard is on every route that could produce a figure or a link, not
   * only on the one that creates a statement.
   *
   * Today nothing turns an at-need case back into a pre-need one — the only
   * conversion in the product goes the other way, on the morning somebody
   * dies. This writes the column directly to stand in for whatever future
   * edit does reach that state: an import, a correction, a case opened under
   * the wrong kind. The point of the check is that it does not depend on the
   * route the case took to get here.
   */
  it("still refuses once a case is pre-need, whatever made it so", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const draft = await draftFor(staff, row.id);

    await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send(SERVICE)
      .expect(201);

    await db
      .update(casesTable)
      .set({ kind: "pre_need" })
      .where(eq(casesTable.id, row.id));

    await staff.agent
      .post(`/api/statements/${draft.id}/lines`)
      .send(CASKET)
      .expect(400);
    await staff.agent
      .post(`/api/statements/${draft.id}/confirm`)
      .send({})
      .expect(400);

    const { token } = await inviteFamily(staff, row.id);
    const res = await asFamily(token).get("/api/family/statement").expect(200);
    expect(res.body.statement).toBeNull();
    expect(res.body.payment).toBeNull();
  });
});

describe("no code path in this component moves money", () => {
  /**
   * A source check rather than a behaviour check, because the failure this
   * guards against is a future edit rather than a present bug: somebody adds
   * "just a quick Stripe charge" to the statement screen, every functional
   * test still passes, and the company acquires a money-transmission problem
   * in forty states.
   *
   * The one Stripe integration in this application is `lib/billing.ts`, which
   * is us charging the home its monthly subscription. It is not in this list
   * and it must never be reached from one that is.
   */
  const COMPONENT_FILES = [
    "src/routes/orders.ts",
    "src/lib/statement.ts",
    "src/lib/statement-render.ts",
    "../../lib/db/src/schema/orders.ts",
  ];

  /**
   * Comments are stripped before the check, because the comments are where
   * the rule is written down — "the one Stripe integration is the home's
   * subscription, do not extend it to families" is exactly the sentence that
   * should be in this code and exactly the sentence a naive grep trips over.
   * Block comments and whole-line comments go; a trailing `// ...` does not,
   * so a stray one fails the test rather than slipping through, which is the
   * direction to fail in.
   */
  function withoutComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split(/\r?\n/)
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
  }

  const FORBIDDEN = [
    /\bstripe\b/i,
    /\bpaypal\b/i,
    /\bcard(?:Number|holder)\b/i,
    /\bcvc\b|\bcvv\b/i,
    /\brouting[_ ]?number\b/i,
    /\baccount[_ ]?number\b/i,
    /\bcharge(?:s|d)?\(/i,
    /\bpaymentIntent\b/i,
    /\bcheckout\.session\b/i,
  ];

  it("mentions no processor and stores no card or bank detail", () => {
    for (const relative of COMPONENT_FILES) {
      const source = withoutComments(
        readFileSync(join(import.meta.dirname, "..", relative), "utf8"),
      );

      for (const pattern of FORBIDDEN) {
        expect(
          pattern.test(source),
          `${relative} matches ${pattern} — this component takes no money`,
        ).toBe(false);
      }
    }
  });

  it("imports nothing from the subscription billing module", () => {
    for (const relative of COMPONENT_FILES) {
      const source = withoutComments(
        readFileSync(join(import.meta.dirname, "..", relative), "utf8"),
      );

      expect(source).not.toMatch(/from\s+["'][^"']*billing["']/);
    }
  });

  it("adds no dependency that could take a payment", () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };

    const added = Object.keys(pkg.dependencies).filter((name) =>
      /stripe|braintree|paypal|square|adyen|checkout/i.test(name),
    );

    // `stripe` itself is absent: the subscription is taken through Stripe's
    // hosted checkout over HTTP, and nothing here needs a payments SDK.
    expect(added).toEqual([]);
  });

  it("puts no payment field on any screen a family can reach", () => {
    const pages = join(
      import.meta.dirname,
      "../../family-portal/src/pages",
    );

    for (const entry of readdirSync(pages)) {
      if (!entry.endsWith(".tsx")) continue;

      const source = readFileSync(join(pages, entry), "utf8");

      expect(
        source,
        `${entry} looks like it collects payment details`,
      ).not.toMatch(/card ?number|cvc|cvv|sort ?code|routing ?number/i);
    }
  });
});

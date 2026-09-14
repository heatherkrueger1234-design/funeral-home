import { Router, type IRouter } from "express";
import { and, eq, max, ne } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  casesTable,
  paymentHandoffTable,
  statementLinesTable,
  statementsTable,
  isUnpricedKind,
  paymentPageUrlProblem,
  STATEMENT_LINE_KINDS,
  type Statement,
  type StatementLine,
} from "@workspace/db";
import {
  assertHasUpdates,
  badRequest,
  parseBody,
  parseId,
  requireRow,
} from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import { familyCase, familyHome } from "../middleware/require-family";
import {
  assertDraft,
  assertNotPreNeed,
  confirmedStatementForCase,
  handoffForHome,
  linesForStatement,
  statementsForCase,
  toHandoffJson,
  toStatementJson,
  withLines,
} from "../lib/statement";
import { renderStatement } from "../lib/statement-render";
import { loadCase } from "./cases";

/**
 * The statement, and handing the family off to the home to settle it.
 *
 * **No route in this file moves money.** There is no processor here, no
 * charge, no refund, no funds held and no card or bank detail accepted
 * anywhere — the closest this surface comes is storing a hyperlink the home
 * typed in and reading it back out. The one Stripe integration in this
 * application is us billing the home for its subscription, in `billing.ts`,
 * and it is not extended to families. `test/statement.test.ts` asserts both
 * of those, because a rule that is only written down is one somebody will
 * eventually write around.
 *
 * The request bodies are validated by hand-written zod below rather than by
 * `@workspace/api-zod`. TODO(C1): the OpenAPI spec is one file that every
 * component would have to edit at once until Component 1 splits it per
 * domain, so nothing here is in the spec yet. When `lib/api-spec/paths/`
 * exists, `orders.yaml` moves these there and the generated validators
 * replace them.
 */

const router: IRouter = Router();

/* ------------------------------------------------------------- the bodies */

const cents = z
  .number()
  .int("Prices are in whole cents.")
  .min(0, "A price cannot be negative. Record a discount as an allowance.")
  // A hundred thousand dollars. Not a policy about what a funeral may cost —
  // a guard against a director typing a price in cents that was meant to be
  // in dollars, which is the mistake this column invites.
  .max(10_000_000, "That looks like a typing slip. Please check the amount.");

const LineBody = z.object({
  kind: z.enum(STATEMENT_LINE_KINDS),
  description: z.string().min(1).max(400),
  detail: z.string().max(2_000).nullish(),
  quantity: z.number().int().min(1).max(999).optional(),
  unitAmountCents: cents.optional(),
  disclosure: z.string().max(2_000).nullish(),
  catalogueItemId: z.number().int().positive().nullish(),
});

const LineUpdateBody = LineBody.partial();

const StatementBody = z.object({
  reference: z.string().max(120).nullish(),
  notes: z.string().max(4_000).nullish(),
});

const SettleBody = z.object({
  note: z.string().max(400).nullish(),
});

const HandoffBody = z.object({
  paymentPageUrl: z.string().max(2_000).nullish(),
  otherWaysToPay: z.string().max(2_000).nullish(),
});

/* ------------------------------------------------------------- the loads  */

async function loadStatementById(
  statementId: number,
  funeralHomeId: number,
): Promise<Statement> {
  const [row] = await db
    .select()
    .from(statementsTable)
    .where(
      and(
        eq(statementsTable.id, statementId),
        eq(statementsTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  return requireRow(row, "That statement could not be found.");
}

function loadStatement(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
): Promise<Statement> {
  return loadStatementById(parseId(rawId), tenant(req).id);
}

async function loadLine(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
): Promise<StatementLine> {
  const home = tenant(req);
  const id = parseId(rawId);

  const [row] = await db
    .select()
    .from(statementLinesTable)
    .where(
      and(
        eq(statementLinesTable.id, id),
        eq(statementLinesTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  return requireRow(row, "That line could not be found.");
}

/** The case a statement belongs to, re-read so its kind can be checked. */
async function caseForStatement(row: Statement) {
  const [found] = await db
    .select()
    .from(casesTable)
    .where(
      and(
        eq(casesTable.id, row.caseId),
        eq(casesTable.funeralHomeId, row.funeralHomeId),
      ),
    )
    .limit(1);

  return requireRow(found, "That case could not be found.");
}

/**
 * A line the family brought in themselves carries no price and cannot be
 * given one — not by a careless caller and not by a later feature.
 *
 * The Funeral Rule forbids a provider from refusing a third-party casket or
 * urn and from charging a handling fee for one, and this is where that stops
 * being a paragraph in a brief and becomes something the API will not do.
 */
function normaliseAmount(kind: string, requested: number | undefined): number {
  if (!isUnpricedKind(kind)) return requested ?? 0;

  if (requested !== undefined && requested !== 0) {
    throw badRequest(
      "Something the family brought in themselves cannot carry a charge. " +
        "Handling a casket or urn bought elsewhere is free, and the Funeral " +
        "Rule requires it to stay free.",
    );
  }

  return 0;
}

/* ----------------------------------------------------------- the handoff  */

router.get("/payment-handoff", async (req, res) => {
  const home = tenant(req);
  res.json(toHandoffJson(await handoffForHome(home.id), home));
});

/**
 * Where the home's own payment page lives.
 *
 * The URL is checked rather than trusted, and the check is deliberately
 * unhelpful about anything except a plain `https://` address on a real
 * website: this link is sent to a grieving family beside a figure they owe,
 * which is the exact shape of a funeral scam. It has to be dull, expected and
 * visibly the home's own.
 */
router.put("/payment-handoff", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const values = assertHasUpdates(parseBody(HandoffBody, req.body));

  const url = values.paymentPageUrl?.trim() || null;

  if (url !== null) {
    const problem = paymentPageUrlProblem(url);
    if (problem) throw badRequest(problem);
  }

  const otherWaysToPay = values.otherWaysToPay?.trim() || null;
  const existing = await handoffForHome(home.id);

  const next = {
    paymentPageUrl:
      values.paymentPageUrl === undefined ? existing?.paymentPageUrl ?? null : url,
    otherWaysToPay:
      values.otherWaysToPay === undefined
        ? existing?.otherWaysToPay ?? null
        : otherWaysToPay,
    updatedAt: new Date(),
    updatedByUserId: user.id,
  };

  if (existing) {
    await db
      .update(paymentHandoffTable)
      .set(next)
      .where(eq(paymentHandoffTable.id, existing.id));
  } else {
    await db
      .insert(paymentHandoffTable)
      .values({ funeralHomeId: home.id, ...next });
  }

  res.json(toHandoffJson(await handoffForHome(home.id), home));
});

/* ------------------------------------------------------- staff: statements */

router.get("/cases/:caseId/statements", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  const rows = await statementsForCase(row.id, home.id);
  const withEverything = await Promise.all(rows.map(withLines));

  res.json(withEverything.map(toStatementJson));
});

/**
 * Start working on one.
 *
 * A revision starts from the confirmed statement rather than from nothing,
 * because the reason a director opens one is almost always that a single line
 * changed — the cemetery quoted a different figure, the family added twelve
 * more certified copies — and retyping thirty lines to correct one is how a
 * second mistake gets made.
 */
router.post("/cases/:caseId/statements", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  assertNotPreNeed(row);

  const existing = await statementsForCase(row.id, home.id);
  const open = existing.find((entry) => entry.status === "draft");

  if (open) {
    throw badRequest(
      "There is already a statement in progress for this case. Finish or " +
        "confirm that one first.",
    );
  }

  const latest = existing[0] ?? null;
  const previous = existing.find((entry) => entry.status === "confirmed") ?? null;

  const [created] = await db
    .insert(statementsTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      version: (latest?.version ?? 0) + 1,
      supersedesStatementId: previous?.id ?? null,
      reference: previous?.reference ?? null,
      notes: previous?.notes ?? null,
    })
    .returning();

  if (previous) {
    const carried = await linesForStatement(previous.id);

    if (carried.length > 0) {
      await db.insert(statementLinesTable).values(
        carried.map((line) => ({
          funeralHomeId: home.id,
          statementId: created!.id,
          kind: line.kind,
          description: line.description,
          detail: line.detail,
          catalogueItemId: line.catalogueItemId,
          quantity: line.quantity,
          unitAmountCents: line.unitAmountCents,
          disclosure: line.disclosure,
          position: line.position,
        })),
      );
    }
  }

  res.status(201).json(toStatementJson(await withLines(created!)));
});

router.get("/statements/:statementId", async (req, res) => {
  const row = await loadStatement(req, req.params.statementId);
  res.json(toStatementJson(await withLines(row)));
});

router.put("/statements/:statementId", async (req, res) => {
  const row = await loadStatement(req, req.params.statementId);
  const values = assertHasUpdates(parseBody(StatementBody, req.body));

  assertDraft(row);

  const [updated] = await db
    .update(statementsTable)
    .set({
      ...(values.reference === undefined
        ? {}
        : { reference: values.reference?.trim() || null }),
      ...(values.notes === undefined
        ? {}
        : { notes: values.notes?.trim() || null }),
      updatedAt: new Date(),
    })
    .where(eq(statementsTable.id, row.id))
    .returning();

  res.json(toStatementJson(await withLines(updated!)));
});

router.post("/statements/:statementId/lines", async (req, res) => {
  const home = tenant(req);
  const row = await loadStatement(req, req.params.statementId);
  const values = parseBody(LineBody, req.body);

  assertDraft(row);
  assertNotPreNeed(await caseForStatement(row));

  const description = values.description.trim();
  if (!description) throw badRequest("Please say what the item is.");

  const [last] = await db
    .select({ value: max(statementLinesTable.position) })
    .from(statementLinesTable)
    .where(eq(statementLinesTable.statementId, row.id));

  await db
    .insert(statementLinesTable)
    .values({
      funeralHomeId: home.id,
      statementId: row.id,
      kind: values.kind,
      description,
      detail: values.detail?.trim() || null,
      catalogueItemId: values.catalogueItemId ?? null,
      quantity: isUnpricedKind(values.kind) ? 1 : values.quantity ?? 1,
      unitAmountCents: normaliseAmount(values.kind, values.unitAmountCents),
      disclosure: values.disclosure?.trim() || null,
      position: (last?.value ?? -1) + 1,
    });

  res.status(201).json(toStatementJson(await withLines(row)));
});

router.put("/statement-lines/:lineId", async (req, res) => {
  const existing = await loadLine(req, req.params.lineId);
  const values = assertHasUpdates(parseBody(LineUpdateBody, req.body));
  const statement = await loadStatementById(existing.statementId, existing.funeralHomeId);

  assertDraft(statement);

  const kind = values.kind ?? existing.kind;
  const requested =
    values.unitAmountCents === undefined
      ? isUnpricedKind(kind)
        ? undefined
        : existing.unitAmountCents
      : values.unitAmountCents;

  await db
    .update(statementLinesTable)
    .set({
      kind,
      ...(values.description === undefined
        ? {}
        : { description: values.description.trim() }),
      ...(values.detail === undefined
        ? {}
        : { detail: values.detail?.trim() || null }),
      ...(values.disclosure === undefined
        ? {}
        : { disclosure: values.disclosure?.trim() || null }),
      ...(values.catalogueItemId === undefined
        ? {}
        : { catalogueItemId: values.catalogueItemId ?? null }),
      quantity: isUnpricedKind(kind) ? 1 : values.quantity ?? existing.quantity,
      unitAmountCents: normaliseAmount(kind, requested),
      updatedAt: new Date(),
    })
    .where(eq(statementLinesTable.id, existing.id));

  res.json(toStatementJson(await withLines(statement)));
});

router.delete("/statement-lines/:lineId", async (req, res) => {
  const existing = await loadLine(req, req.params.lineId);
  const statement = await loadStatementById(existing.statementId, existing.funeralHomeId);

  assertDraft(statement);

  await db
    .delete(statementLinesTable)
    .where(eq(statementLinesTable.id, existing.id));

  res.json(toStatementJson(await withLines(statement)));
});

/**
 * Hand it over.
 *
 * Confirming is the moment the document becomes the one the family was given,
 * so it is also the moment it stops being editable. Any earlier confirmed
 * statement on the case is marked superseded rather than deleted: what was
 * once handed to somebody is evidence, and evidence that can be tidied away
 * is not evidence.
 */
router.post("/statements/:statementId/confirm", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadStatement(req, req.params.statementId);

  assertDraft(row);
  assertNotPreNeed(await caseForStatement(row));

  const lines = await linesForStatement(row.id);

  if (lines.length === 0) {
    throw badRequest(
      "There is nothing on this statement yet. Add what the family chose first.",
    );
  }

  const now = new Date();

  await db
    .update(statementsTable)
    .set({ status: "superseded", updatedAt: now })
    .where(
      and(
        eq(statementsTable.caseId, row.caseId),
        eq(statementsTable.funeralHomeId, home.id),
        eq(statementsTable.status, "confirmed"),
        ne(statementsTable.id, row.id),
      ),
    );

  const [updated] = await db
    .update(statementsTable)
    .set({
      status: "confirmed",
      confirmedAt: now,
      confirmedByUserId: user.id,
      updatedAt: now,
    })
    .where(eq(statementsTable.id, row.id))
    .returning();

  res.json(toStatementJson(await withLines(updated!)));
});

/**
 * A note about the home's own books, and nothing more than that.
 *
 * We do not process the payment, are not told when one is made, and have no
 * way to check. What this records is that a member of staff looked at the
 * home's records and said so — which is why the route is called `settled`,
 * why the response carries who marked it, and why no sentence rendered from
 * it anywhere says "paid" or "received".
 */
router.post("/statements/:statementId/settled", async (req, res) => {
  const user = currentUser(req);
  const row = await loadStatement(req, req.params.statementId);
  const values = parseBody(SettleBody, req.body);

  if (row.status !== "confirmed") {
    throw badRequest(
      "Only a confirmed statement can be marked settled. Confirm it first.",
    );
  }

  const [updated] = await db
    .update(statementsTable)
    .set({
      settledAt: new Date(),
      settledByUserId: user.id,
      settledNote: values.note?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(statementsTable.id, row.id))
    .returning();

  res.json(toStatementJson(await withLines(updated!)));
});

/** Undo the mark, for the afternoon it was put on the wrong case. */
router.delete("/statements/:statementId/settled", async (req, res) => {
  const row = await loadStatement(req, req.params.statementId);

  const [updated] = await db
    .update(statementsTable)
    .set({
      settledAt: null,
      settledByUserId: null,
      settledNote: null,
      updatedAt: new Date(),
    })
    .where(eq(statementsTable.id, row.id))
    .returning();

  res.json(toStatementJson(await withLines(updated!)));
});

router.get("/statements/:statementId/print", async (req, res) => {
  const home = tenant(req);
  const row = await loadStatement(req, req.params.statementId);
  const forCase = await caseForStatement(row);

  const statement = await withLines(row);

  res.type("html").send(
    renderStatement({
      statement,
      case: forCase,
      home,
      handoff: toHandoffJson(await handoffForHome(home.id), home),
    }),
  );
});

/* ------------------------------------------------------- the family's copy */

/**
 * What the family sees, on the family gate.
 *
 * Mounted under `/family` in `routes/index.ts` alongside the main family
 * router, so it inherits the link-token gate and carries no case id — the
 * token names the case and there is nothing here to tamper with.
 */
const familyRouter: IRouter = Router();

/**
 * The one confirmed statement, the total, and where the home takes payment.
 *
 * A pre-need case returns nothing at all, and that is the whole feature: the
 * plan is recorded, the money is not discussed. There is no figure, no link
 * and no mention of either, because a total plus a way to pay it is a preneed
 * contract, and selling one of those in Colorado needs a Division of
 * Insurance licence and 85% of the money in trust.
 *
 * With no confirmed statement the answer is also nothing — an empty response
 * rather than a 404, so the portal can say "your director is still putting
 * this together" instead of showing a family an error about their mother.
 */
familyRouter.get("/statement", async (req, res) => {
  const row = familyCase(req);
  const home = familyHome(req);

  if (row.kind === "pre_need") {
    res.json({ statement: null, payment: null });
    return;
  }

  const confirmed = await confirmedStatementForCase(row.id, home.id);

  if (!confirmed) {
    res.json({ statement: null, payment: null });
    return;
  }

  res.json({
    statement: toStatementJson(await withLines(confirmed)),
    payment: toHandoffJson(await handoffForHome(home.id), home),
  });
});

/**
 * Their own copy, to print or to save. No account, no login, no asking us
 * for it again in a year — a document about your own mother should not be
 * hostage to a vendor's uptime.
 */
familyRouter.get("/statement/print", async (req, res) => {
  const row = familyCase(req);
  const home = familyHome(req);

  if (row.kind === "pre_need") {
    throw badRequest("There is no statement on a pre-need file.");
  }

  const confirmed = await confirmedStatementForCase(row.id, home.id);

  if (!confirmed) {
    throw badRequest(
      "Your funeral director has not finished this yet. They will let you know when it is ready.",
    );
  }

  res.type("html").send(
    renderStatement({
      statement: await withLines(confirmed),
      case: row,
      home,
      handoff: toHandoffJson(await handoffForHome(home.id), home),
    }),
  );
});

export { familyRouter as familyStatementRouter };
export default router;

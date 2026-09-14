import { and, asc, desc, eq } from "drizzle-orm";
import {
  db,
  paymentHandoffTable,
  statementLinesTable,
  statementsTable,
  formatUsd,
  isUnpricedKind,
  lineSubtotalCents,
  paymentPageHost,
  statementTotalCents,
  type Case,
  type FuneralHome,
  type PaymentHandoff,
  type Statement,
  type StatementLine,
} from "@workspace/db";
import { badRequest } from "./http";

/**
 * Reading and adding up a statement, and describing the handoff to the home.
 *
 * Nothing in this file talks to a payment processor, because nothing in this
 * product does. The furthest it goes towards money is producing a hyperlink
 * and the sentence that explains where the hyperlink goes.
 */

export type StatementWithLines = Statement & { lines: StatementLine[] };

export async function linesForStatement(
  statementId: number,
): Promise<StatementLine[]> {
  return db
    .select()
    .from(statementLinesTable)
    .where(eq(statementLinesTable.statementId, statementId))
    .orderBy(asc(statementLinesTable.position), asc(statementLinesTable.id));
}

export async function withLines(row: Statement): Promise<StatementWithLines> {
  return { ...row, lines: await linesForStatement(row.id) };
}

/** Every statement on a case, newest first. */
export async function statementsForCase(
  caseId: number,
  funeralHomeId: number,
): Promise<Statement[]> {
  return db
    .select()
    .from(statementsTable)
    .where(
      and(
        eq(statementsTable.caseId, caseId),
        eq(statementsTable.funeralHomeId, funeralHomeId),
      ),
    )
    .orderBy(desc(statementsTable.version), desc(statementsTable.id));
}

/**
 * The one the family is shown: the most recent confirmed statement.
 *
 * Drafts never qualify. A family who watches a total move about while the
 * director is still working is being shown a number that is not yet a number,
 * and the Colorado Consumer Protection Act view of price presentation — the
 * first figure somebody sees is the one they pay — is the right instinct here
 * even where it is not the letter of the thing.
 */
export async function confirmedStatementForCase(
  caseId: number,
  funeralHomeId: number,
): Promise<Statement | null> {
  const [row] = await db
    .select()
    .from(statementsTable)
    .where(
      and(
        eq(statementsTable.caseId, caseId),
        eq(statementsTable.funeralHomeId, funeralHomeId),
        eq(statementsTable.status, "confirmed"),
      ),
    )
    .orderBy(desc(statementsTable.version), desc(statementsTable.id))
    .limit(1);

  return row ?? null;
}

/**
 * The gate on the whole component: a pre-need case has no statement.
 *
 * Someone arranging their own funeral in advance is recording a plan. Putting
 * a total and a payment link in front of them is selling a preneed contract,
 * and under C.R.S. Title 10 Article 15 that needs a Division of Insurance
 * licence, a $500 filing fee, $100,000 of net worth or a bond, and 85% of
 * whatever is taken placed in trust — or insurance funding instead. There is
 * no third method, and there is certainly no method involving a hyperlink.
 *
 * So the block is here, once, and every route that could produce a figure or
 * a link calls it. If a home sells preneed contracts they do it under their
 * own licence, through their own trustee or insurer, outside this software.
 *
 * The message is written for a director reading it, because a director is the
 * only person who can reach this.
 */
export function assertNotPreNeed(row: Pick<Case, "kind">): void {
  if (row.kind === "pre_need") {
    throw badRequest(
      "This is a pre-need case, so there is no statement and no payment here. " +
        "Pre-need selling is licensed by the Division of Insurance and happens " +
        "through your own trustee or insurer. Record the plan here; take the " +
        "money there.",
    );
  }
}

/** A statement stops being editable the moment it is handed over. */
export function assertDraft(row: Statement): void {
  if (row.status !== "draft") {
    throw badRequest(
      "This statement has already been confirmed, so it stays as it was given. " +
        "Start a revision to change anything.",
    );
  }
}

/* ------------------------------------------------------------ the handoff */

export async function handoffForHome(
  funeralHomeId: number,
): Promise<PaymentHandoff | null> {
  const [row] = await db
    .select()
    .from(paymentHandoffTable)
    .where(eq(paymentHandoffTable.funeralHomeId, funeralHomeId))
    .limit(1);

  return row ?? null;
}

/**
 * What the family is told about paying, and it is all the home's.
 *
 * `host` is sent separately from `url` so the portal can show the family
 * where the link actually goes without parsing a URL in a browser that may
 * not agree with ours. The whole design of this is defensive: a link about
 * money arriving beside a death notice is exactly the shape of a scam, so the
 * family is told the home's name and the home's website address before they
 * are asked to click anything.
 */
export type PaymentHandoffJson = {
  url: string | null;
  host: string | null;
  otherWaysToPay: string | null;
  /** So a family that would rather ring somebody always can. */
  phone: string | null;
};

export function toHandoffJson(
  handoff: PaymentHandoff | null,
  home: FuneralHome,
): PaymentHandoffJson {
  const url = handoff?.paymentPageUrl ?? null;

  return {
    url,
    host: url === null ? null : paymentPageHost(url),
    otherWaysToPay: handoff?.otherWaysToPay ?? null,
    phone: home.phone,
  };
}

/* --------------------------------------------------------------- the JSON */

export type StatementLineJson = {
  id: number;
  kind: string;
  description: string;
  detail: string | null;
  quantity: number;
  unitAmountCents: number;
  /** Null where the kind carries no price, so no client renders a "$0.00". */
  subtotalCents: number | null;
  amount: string | null;
  disclosure: string | null;
  position: number;
  catalogueItemId: number | null;
};

export function toLineJson(line: StatementLine): StatementLineJson {
  const unpriced = isUnpricedKind(line.kind);
  const subtotal = lineSubtotalCents(line);

  return {
    id: line.id,
    kind: line.kind,
    description: line.description,
    detail: line.detail,
    quantity: line.quantity,
    unitAmountCents: unpriced ? 0 : line.unitAmountCents,
    subtotalCents: unpriced ? null : subtotal,
    amount: unpriced ? null : formatUsd(subtotal),
    disclosure: line.disclosure,
    position: line.position,
    catalogueItemId: line.catalogueItemId,
  };
}

export type StatementJson = {
  id: number;
  status: string;
  version: number;
  reference: string | null;
  notes: string | null;
  confirmedAt: Date | null;
  /**
   * That the home's own books say this is settled. Never a receipt from us —
   * we do not process the payment and are not told when one is made.
   */
  settledAt: Date | null;
  settledNote: string | null;
  lines: StatementLineJson[];
  totalCents: number;
  total: string;
  createdAt: Date;
  updatedAt: Date;
};

export function toStatementJson(row: StatementWithLines): StatementJson {
  const totalCents = statementTotalCents(row.lines);

  return {
    id: row.id,
    status: row.status,
    version: row.version,
    reference: row.reference,
    notes: row.notes,
    confirmedAt: row.confirmedAt,
    settledAt: row.settledAt,
    settledNote: row.settledNote,
    lines: row.lines.map(toLineJson),
    totalCents,
    total: formatUsd(totalCents),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

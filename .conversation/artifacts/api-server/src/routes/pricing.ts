import { Router, type IRouter } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  homePriceItemsTable,
  formatAmount,
  type HomePriceItem,
} from "@workspace/db";
import { CreatePriceItemBody, UpdatePriceItemBody } from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  HttpError,
  parseBody,
  parseId,
} from "../lib/http";
import { tenant } from "../middleware/require-auth";

/**
 * The home's own prices, for the home's own staff.
 *
 * Every route in this file is mounted below `requireAuth` in `index.ts`, and
 * that is the whole of what makes this staff-only. There is deliberately no
 * family route and no public route that reads `home_price_items` — read the
 * comment at the top of `schema/price-list.ts` before adding one, because
 * the FTC Funeral Rule makes "we also show these to families" a much larger
 * decision than it looks from here.
 *
 * `price-list.test.ts` asserts the absence, so a future handler that
 * helpfully folds prices into the family's session fails CI rather than
 * shipping.
 *
 * Any signed-in staff member may read and write these, unlike the storefront
 * next door. A price sheet is a working document that the person arranging
 * at a kitchen table needs to correct at the kitchen table; making it
 * owner-only would mean the one number that is wrong stays wrong until
 * Monday.
 */

const router: IRouter = Router();

const MAX_PRICE_ITEMS = 200;

function toPriceItemJson(row: HomePriceItem) {
  return {
    id: row.id,
    category: row.category,
    label: row.label,
    amountCents: row.amountCents,
    // Formatted once, here, so the console and a printed sheet cannot round
    // the same casket to two different numbers.
    amountLabel: formatAmount(row.amountCents),
    note: row.note,
    position: row.position,
    enabled: row.enabled,
  };
}

router.get("/home/price-list", async (req, res) => {
  const home = tenant(req);

  const rows = await db
    .select()
    .from(homePriceItemsTable)
    .where(eq(homePriceItemsTable.funeralHomeId, home.id))
    .orderBy(
      asc(homePriceItemsTable.category),
      asc(homePriceItemsTable.position),
      asc(homePriceItemsTable.id),
    );

  res.json(rows.map(toPriceItemJson));
});

router.post("/home/price-list", async (req, res) => {
  const home = tenant(req);
  const values = parseBody(CreatePriceItemBody, req.body);

  const category = values.category.trim();

  const [count] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(homePriceItemsTable)
    .where(eq(homePriceItemsTable.funeralHomeId, home.id));

  if ((count?.value ?? 0) >= MAX_PRICE_ITEMS) {
    throw badRequest(
      `That is ${MAX_PRICE_ITEMS} lines. Anything longer belongs in the system the home already runs its accounts from.`,
    );
  }

  // Position within the category, because the sheet is read a category at a
  // time and a new casket belongs at the bottom of the caskets.
  const [inCategory] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(homePriceItemsTable)
    .where(
      and(
        eq(homePriceItemsTable.funeralHomeId, home.id),
        eq(homePriceItemsTable.category, category),
      ),
    );

  const [created] = await db
    .insert(homePriceItemsTable)
    .values({
      funeralHomeId: home.id,
      category,
      label: values.label.trim(),
      amountCents: values.amountCents ?? null,
      note: values.note?.trim() || null,
      position: inCategory?.value ?? 0,
    })
    .returning();

  res.status(201).json(toPriceItemJson(created!));
});

router.put("/price-items/:itemId", async (req, res) => {
  const home = tenant(req);
  const id = parseId(req.params.itemId);
  const values = assertHasUpdates(parseBody(UpdatePriceItemBody, req.body));

  const [updated] = await db
    .update(homePriceItemsTable)
    .set({
      ...values,
      ...(values.category === undefined
        ? {}
        : { category: values.category.trim() }),
      ...(values.label === undefined ? {} : { label: values.label.trim() }),
      ...(values.note === undefined
        ? {}
        : { note: values.note?.trim() || null }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(homePriceItemsTable.id, id),
        eq(homePriceItemsTable.funeralHomeId, home.id),
      ),
    )
    .returning();

  if (!updated) throw new HttpError(404, "No such price line.");

  res.json(toPriceItemJson(updated));
});

router.delete("/price-items/:itemId", async (req, res) => {
  const home = tenant(req);
  const id = parseId(req.params.itemId);

  const [deleted] = await db
    .delete(homePriceItemsTable)
    .where(
      and(
        eq(homePriceItemsTable.id, id),
        eq(homePriceItemsTable.funeralHomeId, home.id),
      ),
    )
    .returning({ id: homePriceItemsTable.id });

  if (!deleted) throw new HttpError(404, "No such price line.");

  res.status(204).end();
});

export default router;

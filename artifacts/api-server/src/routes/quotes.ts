import { Router, type IRouter } from "express";
import { db, quotesTable } from "@workspace/db";
import { CreateQuoteBody, GetQuotesQueryParams } from "@workspace/api-zod";
import { eq, desc, and } from "drizzle-orm";
import { parseBody, parseId, parseQuery, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

router.get("/quotes", async (req, res) => {
  const user = currentUser(req);
  const { type } = parseQuery(GetQuotesQueryParams, req.query);
  // "both" is the spec's way of asking for quotes *and* songs — no filter.
  const filter =
    type && type !== "both" ? eq(quotesTable.type, type) : undefined;

  const rows = await db
    .select()
    .from(quotesTable)
    .where(and(eq(quotesTable.userId, user.id), filter))
    .orderBy(desc(quotesTable.createdAt));

  res.json(rows);
});

router.post("/quotes", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateQuoteBody, req.body);

  const [created] = await db
    .insert(quotesTable)
    .values({
      ...values,
      userId: user.id,
      isFavoriteOfChild: values.isFavoriteOfChild ?? false,
    })
    .returning();

  res.status(201).json(created);
});

router.delete("/quotes/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(quotesTable)
    .where(and(eq(quotesTable.id, id), eq(quotesTable.userId, user.id)))
    .returning({ id: quotesTable.id });

  requireRow(deleted, `Quote ${id} not found`);
  res.status(204).end();
});

export default router;

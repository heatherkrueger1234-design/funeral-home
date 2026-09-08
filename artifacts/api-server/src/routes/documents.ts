import { Router, type IRouter } from "express";
import { db, documentsTable, type Document } from "@workspace/db";
import {
  DecryptionError,
  decryptNullable,
  encryptNullable,
} from "@workspace/db/crypto";
import {
  CreateDocumentBody,
  GetDocumentsQueryParams,
  UpdateDocumentBody,
} from "@workspace/api-zod";
import { eq, desc, and } from "drizzle-orm";
import {
  assertHasUpdates,
  parseBody,
  parseId,
  parseQuery,
  requireRow,
} from "../lib/http";
import { currentUser } from "../middleware/require-auth";

const router: IRouter = Router();

/** The two columns that hold passwords, medical detail and autopsy notes. */
type Readable = Omit<Document, "content" | "notes"> & {
  content: string | null;
  notes: string | null;
  contentHidden?: boolean;
  contentUnreadable?: boolean;
};

/**
 * A row whose ciphertext will not authenticate is reported as unreadable
 * rather than thrown. One corrupted record should not take down the page and
 * hide the dozen intact ones next to it — and the person should be told the
 * record is unreadable rather than shown an empty box that looks like they
 * never wrote anything.
 */
function reveal(row: Document): Readable {
  try {
    return {
      ...row,
      content: decryptNullable(row.content),
      notes: decryptNullable(row.notes),
    };
  } catch (error) {
    if (!(error instanceof DecryptionError)) throw error;
    return { ...row, content: null, notes: null, contentUnreadable: true };
  }
}

/**
 * `isPrivate` used to be written on every insert and read by nothing at all —
 * a checkbox that promised something the code never did. It now means what a
 * reader would assume: the body of the document is not included in list
 * responses, and has to be asked for by id. A password does not belong in a
 * payload rendered behind someone on a bus.
 */
function forList(row: Document): Readable {
  if (!row.isPrivate) {
    return { ...reveal(row), contentHidden: false };
  }

  return { ...row, content: null, notes: null, contentHidden: true };
}

router.get("/documents", async (req, res) => {
  const user = currentUser(req);
  const { category } = parseQuery(GetDocumentsQueryParams, req.query);
  const filter = category ? eq(documentsTable.category, category) : undefined;

  const rows = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.userId, user.id), filter))
    .orderBy(desc(documentsTable.createdAt));

  res.json(rows.map(forList));
});

router.get("/documents/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [row] = await db
    .select()
    .from(documentsTable)
    .where(
      and(eq(documentsTable.id, id), eq(documentsTable.userId, user.id)),
    )
    .limit(1);

  res.json(reveal(requireRow(row, `Document ${id} not found`)));
});

router.post("/documents", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateDocumentBody, req.body);

  const [created] = await db
    .insert(documentsTable)
    .values({
      ...values,
      userId: user.id,
      content: encryptNullable(values.content),
      notes: encryptNullable(values.notes),
      isPrivate: values.isPrivate ?? true,
    })
    .returning();

  res.status(201).json(reveal(created));
});

router.put("/documents/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const values = assertHasUpdates(
    parseBody(UpdateDocumentBody.partial(), req.body),
  );

  const [updated] = await db
    .update(documentsTable)
    .set({
      ...values,
      // Only re-encrypt what was actually sent; an absent key must not blank
      // the stored value.
      ...("content" in values
        ? { content: encryptNullable(values.content) }
        : {}),
      ...("notes" in values ? { notes: encryptNullable(values.notes) } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(documentsTable.id, id), eq(documentsTable.userId, user.id)))
    .returning();

  res.json(reveal(requireRow(updated, `Document ${id} not found`)));
});

router.delete("/documents/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(documentsTable)
    .where(and(eq(documentsTable.id, id), eq(documentsTable.userId, user.id)))
    .returning({ id: documentsTable.id });

  requireRow(deleted, `Document ${id} not found`);
  res.status(204).end();
});

export default router;

import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  memoriesTable,
  profileTable,
  sharesTable,
  uploadsTable,
} from "@workspace/db";
import { DecryptionError, decryptBuffer } from "@workspace/db/crypto";
import { CreateShareBody } from "@workspace/api-zod";
import { HttpError, notFound, parseBody, parseId, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

/**
 * Read-only public links.
 *
 * This is the only route in the application that returns somebody's private
 * data without a session, so it is written defensively:
 *
 * - The public half is mounted ahead of `requireAuth` in routes/index.ts, and
 *   the owning half after it. They are separate routers so that the split
 *   cannot be lost by reordering a `router.use` line.
 * - Only the SHA-256 of the token is stored, as sessions are, so a database
 *   dump does not hand out working links.
 * - A share names one row of one kind. There is no shape of request here that
 *   widens to a second record, and the resource is re-read through the
 *   sharer's own id on every fetch, so revoking or deleting the memory takes
 *   the link down with it.
 * - The public read returns named fields only. It never spreads a row, which
 *   is what would quietly publish a column added later.
 */

const KNOWN_KINDS = new Set(["memory"]);

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The id in `/api/uploads/123`, if the URL is one of ours. */
function uploadIdFromUrl(url: string | null): number | null {
  if (!url) return null;
  const match = /^\/api\/uploads\/(\d+)$/.exec(url.trim());
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------- public ---

export const publicSharesRouter: IRouter = Router();

/**
 * Resolves a token to the share row, or throws the same 404 for "no such
 * token" and "revoked". Distinguishing them would let someone with an old link
 * learn that it once existed.
 */
async function resolveShare(rawToken: string | undefined) {
  const token = (rawToken ?? "").trim();
  if (!token) throw notFound("This link is not valid.");

  const [share] = await db
    .select()
    .from(sharesTable)
    .where(eq(sharesTable.tokenHash, digest(token)))
    .limit(1);

  if (!share || !KNOWN_KINDS.has(share.kind)) {
    throw notFound("This link is not valid, or it has been turned off.");
  }
  return share;
}

publicSharesRouter.get("/shared/:token", async (req, res) => {
  const share = await resolveShare(req.params.token);

  const [memory] = await db
    .select()
    .from(memoriesTable)
    .where(
      and(
        eq(memoriesTable.id, share.resourceId),
        // Scoped to the sharer, exactly as an owner's own query would be. A
        // share is permission to read one of *their* rows, not an id lookup.
        eq(memoriesTable.userId, share.userId),
      ),
    )
    .limit(1);

  if (!memory) throw notFound("This link is not valid, or it has been turned off.");

  const [profile] = await db
    .select({ childName: profileTable.childName })
    .from(profileTable)
    .where(eq(profileTable.userId, share.userId))
    .limit(1);

  res.json({
    kind: "memory",
    title: memory.title,
    description: memory.description,
    dateTaken: memory.dateTaken,
    // Rewritten to the public route: the ordinary uploads handler requires a
    // session and would 401 for the person the link was sent to.
    imageUrl: uploadIdFromUrl(memory.imageUrl)
      ? `/api/shared/${encodeURIComponent(String(req.params.token))}/image`
      : memory.imageUrl,
    childName: profile?.childName ?? null,
  });
});

/**
 * The photograph on a shared memory.
 *
 * Deliberately not a general "read any upload with a token" endpoint: the
 * upload id is taken from the shared memory rather than from the request, so
 * a link to one memory cannot be turned into a reader for the account's other
 * files.
 */
publicSharesRouter.get("/shared/:token/image", async (req, res) => {
  const share = await resolveShare(req.params.token);

  const [memory] = await db
    .select({ imageUrl: memoriesTable.imageUrl })
    .from(memoriesTable)
    .where(
      and(
        eq(memoriesTable.id, share.resourceId),
        eq(memoriesTable.userId, share.userId),
      ),
    )
    .limit(1);

  const uploadId = uploadIdFromUrl(memory?.imageUrl ?? null);
  if (uploadId === null) throw notFound("No image here.");

  const [upload] = await db
    .select()
    .from(uploadsTable)
    .where(
      and(eq(uploadsTable.id, uploadId), eq(uploadsTable.userId, share.userId)),
    )
    .limit(1);

  if (!upload) throw notFound("No image here.");

  let bytes: Buffer;
  try {
    bytes = decryptBuffer(upload.data);
  } catch (error) {
    if (!(error instanceof DecryptionError)) throw error;
    throw new HttpError(422, "This image could not be opened.");
  }

  res.setHeader("content-type", upload.mimeType);
  res.setHeader("content-length", String(bytes.length));
  res.setHeader("content-disposition", "inline");
  res.setHeader("x-content-type-options", "nosniff");
  // Public, but short: revoking a link should stop working quickly rather
  // than living in a CDN for a day.
  res.setHeader("cache-control", "public, max-age=300");
  res.send(bytes);
});

// ----------------------------------------------------------------- owner ---

const router: IRouter = Router();

router.get("/shares", async (req, res) => {
  const user = currentUser(req);

  // tokenHash is deliberately not selected. It is not secret-equivalent, but
  // there is no reason for it to leave the database.
  const rows = await db
    .select({
      id: sharesTable.id,
      kind: sharesTable.kind,
      resourceId: sharesTable.resourceId,
      label: sharesTable.label,
      createdAt: sharesTable.createdAt,
    })
    .from(sharesTable)
    .where(eq(sharesTable.userId, user.id))
    .orderBy(desc(sharesTable.createdAt));

  res.json(rows);
});

router.post("/shares", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateShareBody, req.body);

  // Prove the row exists and is theirs before minting a link to it, so a
  // share can never point at another account's memory.
  const [memory] = await db
    .select({ id: memoriesTable.id, title: memoriesTable.title })
    .from(memoriesTable)
    .where(
      and(
        eq(memoriesTable.id, values.resourceId),
        eq(memoriesTable.userId, user.id),
      ),
    )
    .limit(1);

  requireRow(memory, `Memory ${values.resourceId} not found`);

  const token = randomBytes(32).toString("base64url");

  const [created] = await db
    .insert(sharesTable)
    .values({
      userId: user.id,
      tokenHash: digest(token),
      kind: values.kind,
      resourceId: values.resourceId,
      label: values.label ?? memory.title,
    })
    .returning({
      id: sharesTable.id,
      kind: sharesTable.kind,
      resourceId: sharesTable.resourceId,
      label: sharesTable.label,
      createdAt: sharesTable.createdAt,
    });

  // The only time the token is ever emitted. It is not recoverable
  // afterwards — losing it means making a new link, which is the trade for
  // not storing anything a dump could use.
  res.status(201).json({
    ...created,
    token,
    url: `/shared/${token}`,
  });
});

router.delete("/shares/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(sharesTable)
    .where(and(eq(sharesTable.id, id), eq(sharesTable.userId, user.id)))
    .returning({ id: sharesTable.id });

  requireRow(deleted, `Share ${id} not found`);
  res.status(204).end();
});

export default router;

import { Router, type IRouter } from "express";
import type { User } from "@workspace/db";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  communityCommentsTable,
  communityPostsTable,
  communityReportsTable,
  usersTable,
} from "@workspace/db";
import {
  CreateCommunityPostBody,
  CreateCommunityCommentBody,
  ReportCommunityContentBody,
  SetScreenNameBody,
  HideCommunityContentBody,
} from "@workspace/api-zod";
import { HttpError, badRequest, parseId, parseBody, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";
import {
  generateScreenName,
  isReservedScreenName,
  normaliseScreenName,
} from "../lib/screen-name";
import { checkForCrisis } from "../lib/crisis-check";
import { logger } from "../lib/logger";

/**
 * The one shared room.
 *
 * Everything else this server exposes is scoped to a single account. This is
 * the deliberate exception, and it is written defensively because the people
 * in it are not in a state to defend themselves:
 *
 * - **Reading requires an account.** Mounted below `requireAuth` in
 *   routes/index.ts. This is not the guides, which are public on purpose: a
 *   parent writing about their child's death in a support room is picturing
 *   other bereaved parents, not a search engine. Making it public later is one
 *   line; making it private again after it has been indexed is not.
 * - **Pseudonymous, never anonymous.** Every row carries `userId` and it is
 *   never sent to other readers. That is what makes moderation possible.
 * - **The reader only ever sees visible rows.** Every select filters
 *   `isNull(hiddenAt)`, so a hidden post cannot reappear through a listing
 *   somebody forgot to filter.
 */

const KINDS = new Set(["signs", "story", "advice"]);
const MAX_TITLE = 140;
const MAX_BODY = 8000;
const MAX_COMMENT = 4000;

/**
 * The screen name this account posts under, assigning one if it has none.
 *
 * Done at post time rather than at registration so an account that never
 * visits the room never gets an identity in it.
 */
async function ensureScreenName(
  userId: number,
  requested?: string | null,
): Promise<string> {
  const [user] = await db
    .select({ screenName: usersTable.screenName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (user?.screenName) return user.screenName;

  const wanted = normaliseScreenName(requested);
  const candidates: string[] = [];
  if (wanted && !isReservedScreenName(wanted)) candidates.push(wanted);
  // Several goes, because the unique index is the real arbiter and a
  // collision on a generated name is possible however unlikely.
  for (let i = 0; i < 8; i++) candidates.push(generateScreenName());

  for (const candidate of candidates) {
    try {
      const [updated] = await db
        .update(usersTable)
        .set({ screenName: candidate, updatedAt: new Date() })
        .where(and(eq(usersTable.id, userId), isNull(usersTable.screenName)))
        .returning({ screenName: usersTable.screenName });

      if (updated?.screenName) return updated.screenName;

      // The row already had a name — another request won the race.
      const [existing] = await db
        .select({ screenName: usersTable.screenName })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (existing?.screenName) return existing.screenName;
    } catch {
      // Unique violation: that name is taken, try the next one.
    }
  }

  throw new HttpError(
    503,
    "Couldn't assign you a name for the room just now. Please try again.",
  );
}

function requireText(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw badRequest(`${field} can't be empty.`);
  if (trimmed.length > max) {
    throw badRequest(`${field} is too long (limit ${max} characters).`);
  }
  return trimmed;
}

const router: IRouter = Router();

// ------------------------------------------------------------- reading -----

router.get("/community/posts", async (req, res) => {
  const user = currentUser(req);
  const raw = req.query.kind;
  if (raw !== undefined && (typeof raw !== "string" || !KINDS.has(raw))) {
    throw badRequest("Unknown kind.");
  }
  const kind = raw as string | undefined;

  const rows = await db
    .select({
      id: communityPostsTable.id,
      userId: communityPostsTable.userId,
      screenName: communityPostsTable.screenName,
      kind: communityPostsTable.kind,
      title: communityPostsTable.title,
      body: communityPostsTable.body,
      createdAt: communityPostsTable.createdAt,
      commentCount: sql<number>`(
        select count(*) from ${communityCommentsTable}
        where ${communityCommentsTable.postId} = ${communityPostsTable.id}
          and ${communityCommentsTable.hiddenAt} is null
      )`,
    })
    .from(communityPostsTable)
    .where(
      kind
        ? and(isNull(communityPostsTable.hiddenAt), eq(communityPostsTable.kind, kind))
        : isNull(communityPostsTable.hiddenAt),
    )
    .orderBy(desc(communityPostsTable.createdAt))
    .limit(200);

  // userId is dropped here rather than left out of the select, so that
  // "is this mine" stays computable without it ever reaching another reader.
  res.json(
    rows.map(({ userId, commentCount, ...post }) => ({
      ...post,
      commentCount: Number(commentCount),
      isMine: userId === user.id,
    })),
  );
});

router.get("/community/posts/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [post] = await db
    .select()
    .from(communityPostsTable)
    .where(and(eq(communityPostsTable.id, id), isNull(communityPostsTable.hiddenAt)))
    .limit(1);

  requireRow(post, `Post ${id} not found`);

  const comments = await db
    .select()
    .from(communityCommentsTable)
    .where(
      and(
        eq(communityCommentsTable.postId, id),
        isNull(communityCommentsTable.hiddenAt),
      ),
    )
    .orderBy(communityCommentsTable.createdAt);

  res.json({
    id: post!.id,
    screenName: post!.screenName,
    kind: post!.kind,
    title: post!.title,
    body: post!.body,
    createdAt: post!.createdAt,
    commentCount: comments.length,
    isMine: post!.userId === user.id,
    comments: comments.map((comment) => ({
      id: comment.id,
      screenName: comment.screenName,
      body: comment.body,
      createdAt: comment.createdAt,
      isMine: comment.userId === user.id,
    })),
  });
});

// ------------------------------------------------------------- writing -----

router.post("/community/posts", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateCommunityPostBody, req.body);

  if (!KINDS.has(values.kind)) throw badRequest("Unknown kind.");
  const title = requireText(values.title, "The title", MAX_TITLE);
  const body = requireText(values.body, "The post", MAX_BODY);

  const screenName = await ensureScreenName(user.id, values.screenName);

  const [created] = await db
    .insert(communityPostsTable)
    .values({ userId: user.id, screenName, kind: values.kind, title, body })
    .returning();

  // Deliberately after the insert. The post goes up either way — a parent who
  // writes "I can't do this any more" and is refused has been told that
  // saying it out loud gets them silenced.
  const crisis = checkForCrisis(title, body);
  if (crisis.matched) {
    logger.warn(
      { postId: created!.id, urgent: crisis.urgent },
      "community post matched crisis phrasing",
    );
  }

  res.status(201).json({
    id: created!.id,
    screenName: created!.screenName,
    kind: created!.kind,
    title: created!.title,
    body: created!.body,
    createdAt: created!.createdAt,
    commentCount: 0,
    isMine: true,
    crisisPrompt: crisis.matched,
  });
});

router.post("/community/posts/:id/comments", async (req, res) => {
  const user = currentUser(req);
  const postId = parseId(req.params.id);
  const values = parseBody(CreateCommunityCommentBody, req.body);
  const body = requireText(values.body, "Your reply", MAX_COMMENT);

  const [post] = await db
    .select({ id: communityPostsTable.id })
    .from(communityPostsTable)
    .where(
      and(eq(communityPostsTable.id, postId), isNull(communityPostsTable.hiddenAt)),
    )
    .limit(1);

  requireRow(post, `Post ${postId} not found`);

  const screenName = await ensureScreenName(user.id);

  const [created] = await db
    .insert(communityCommentsTable)
    .values({ postId, userId: user.id, screenName, body })
    .returning();

  const crisis = checkForCrisis(body);
  if (crisis.matched) {
    logger.warn(
      { commentId: created!.id, urgent: crisis.urgent },
      "community comment matched crisis phrasing",
    );
  }

  res.status(201).json({
    id: created!.id,
    screenName: created!.screenName,
    body: created!.body,
    createdAt: created!.createdAt,
    isMine: true,
    crisisPrompt: crisis.matched,
  });
});

// A person's own words are theirs: their delete is a real delete, unlike
// moderation, which only hides.
router.delete("/community/posts/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(communityPostsTable)
    .where(
      and(eq(communityPostsTable.id, id), eq(communityPostsTable.userId, user.id)),
    )
    .returning({ id: communityPostsTable.id });

  requireRow(deleted, `Post ${id} not found`);
  res.status(204).end();
});

router.delete("/community/comments/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(communityCommentsTable)
    .where(
      and(
        eq(communityCommentsTable.id, id),
        eq(communityCommentsTable.userId, user.id),
      ),
    )
    .returning({ id: communityCommentsTable.id });

  requireRow(deleted, `Reply ${id} not found`);
  res.status(204).end();
});

router.put("/community/screen-name", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(SetScreenNameBody, req.body);

  const wanted = normaliseScreenName(values.screenName);
  if (values.screenName && !wanted) {
    throw badRequest(
      "That name won't work. Use 2–32 letters, numbers, spaces, hyphens or apostrophes.",
    );
  }
  if (wanted && isReservedScreenName(wanted)) {
    throw badRequest("That name is reserved. Please choose another.");
  }

  const next = wanted ?? generateScreenName();

  try {
    const [updated] = await db
      .update(usersTable)
      .set({ screenName: next, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id))
      .returning({ screenName: usersTable.screenName });

    res.json({ screenName: updated!.screenName });
  } catch {
    throw new HttpError(409, "Someone is already using that name.");
  }
});

// ---------------------------------------------------------- moderation -----

router.post("/community/reports", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(ReportCommunityContentBody, req.body);

  if (values.targetType !== "post" && values.targetType !== "comment") {
    throw badRequest("Unknown target.");
  }

  // One report per person per thing, so a count means "how many people".
  const [existing] = await db
    .select({ id: communityReportsTable.id })
    .from(communityReportsTable)
    .where(
      and(
        eq(communityReportsTable.reporterId, user.id),
        eq(communityReportsTable.targetType, values.targetType),
        eq(communityReportsTable.targetId, values.targetId),
      ),
    )
    .limit(1);

  if (!existing) {
    await db.insert(communityReportsTable).values({
      targetType: values.targetType,
      targetId: values.targetId,
      reporterId: user.id,
      reason: values.reason,
      note: values.note?.slice(0, 2000) ?? null,
    });
  }

  logger.warn(
    { targetType: values.targetType, targetId: values.targetId, reason: values.reason },
    "community content reported",
  );

  // Always 201, whether or not this was a duplicate. Telling somebody they
  // already reported it invites them to check whether anything happened.
  res.status(201).end();
});

/** Moderator-only. The flag is set by hand in the database, never by a route. */
function requireModerator(req: { user?: User }) {
  const user = currentUser(req);
  if (!user.isModerator) {
    throw new HttpError(403, "This is only for moderators.");
  }
  return user;
}

router.get("/community/moderation/reports", async (req, res) => {
  requireModerator(req);

  const reports = await db
    .select()
    .from(communityReportsTable)
    .where(isNull(communityReportsTable.resolvedAt))
    .orderBy(desc(communityReportsTable.createdAt))
    .limit(200);

  // Attach what was reported, so a moderator does not have to go and find it.
  const entries = await Promise.all(
    reports.map(async (report) => {
      const [{ value: reportCount }] = await db
        .select({ value: count() })
        .from(communityReportsTable)
        .where(
          and(
            eq(communityReportsTable.targetType, report.targetType),
            eq(communityReportsTable.targetId, report.targetId),
          ),
        );

      let targetBody: string | null = null;
      let targetScreenName: string | null = null;
      let targetHidden = false;

      if (report.targetType === "post") {
        const [post] = await db
          .select()
          .from(communityPostsTable)
          .where(eq(communityPostsTable.id, report.targetId))
          .limit(1);
        if (post) {
          targetBody = `${post.title}\n\n${post.body}`;
          targetScreenName = post.screenName;
          targetHidden = post.hiddenAt !== null;
        }
      } else {
        const [comment] = await db
          .select()
          .from(communityCommentsTable)
          .where(eq(communityCommentsTable.id, report.targetId))
          .limit(1);
        if (comment) {
          targetBody = comment.body;
          targetScreenName = comment.screenName;
          targetHidden = comment.hiddenAt !== null;
        }
      }

      return {
        id: report.id,
        targetType: report.targetType,
        targetId: report.targetId,
        reason: report.reason,
        note: report.note,
        createdAt: report.createdAt,
        targetBody,
        targetScreenName,
        targetHidden,
        reportCount: Number(reportCount),
      };
    }),
  );

  res.json(entries);
});

router.post("/community/moderation/hide", async (req, res) => {
  const moderator = requireModerator(req);
  const values = parseBody(HideCommunityContentBody, req.body);

  const hiddenAt = values.hidden ? new Date() : null;
  const hiddenReason = values.hidden ? (values.reason ?? null) : null;

  if (values.targetType === "post") {
    const [updated] = await db
      .update(communityPostsTable)
      .set({ hiddenAt, hiddenReason, updatedAt: new Date() })
      .where(eq(communityPostsTable.id, values.targetId))
      .returning({ id: communityPostsTable.id });
    requireRow(updated, `Post ${values.targetId} not found`);
  } else if (values.targetType === "comment") {
    const [updated] = await db
      .update(communityCommentsTable)
      .set({ hiddenAt, hiddenReason })
      .where(eq(communityCommentsTable.id, values.targetId))
      .returning({ id: communityCommentsTable.id });
    requireRow(updated, `Reply ${values.targetId} not found`);
  } else {
    throw badRequest("Unknown target.");
  }

  // Acting on the thing closes the reports about it.
  await db
    .update(communityReportsTable)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(communityReportsTable.targetType, values.targetType),
        eq(communityReportsTable.targetId, values.targetId),
        isNull(communityReportsTable.resolvedAt),
      ),
    );

  logger.warn(
    {
      moderatorId: moderator.id,
      targetType: values.targetType,
      targetId: values.targetId,
      hidden: values.hidden,
    },
    "community content moderated",
  );

  res.status(204).end();
});

export default router;

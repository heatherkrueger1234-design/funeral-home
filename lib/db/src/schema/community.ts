import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * The one shared room in an application that is otherwise private by
 * construction.
 *
 * Everything else here is scoped to a single account and nobody else can ever
 * see it. This is the deliberate exception: bereaved parents say repeatedly
 * that the only people who reached them were other bereaved parents, and there
 * is no way to offer that without letting them see each other.
 *
 * The design follows from who is in the room. A grieving parent posting at 3am
 * is not in a state to weigh what they are publishing, and the people who prey
 * on the bereaved specifically look for rooms like this. So:
 *
 * - **Pseudonymous to other users, never anonymous to the operator.** Every
 *   post carries `userId`. Readers see only a screen name. That is what makes
 *   a ban possible, and what stops this becoming an untraceable dumping
 *   ground.
 * - **`hiddenAt` rather than deletion** for moderation, so a removed post can
 *   be looked at afterwards if it mattered. The author's own delete is a real
 *   delete, because their words are theirs.
 * - **Reports are rows, not counters.** Who reported what, and why, is the
 *   only way to tell a brigade from a genuine problem.
 *
 * Nothing here is indexed by search engines and nothing is readable without an
 * account — see routes/community.ts for why that default was chosen.
 */

/** signs, story, advice */
export const communityPostsTable = pgTable(
  "community_posts",
  {
    id: serial("id").primaryKey(),
    /**
     * Never sent to other readers. Present so that moderation and account
     * deletion work, and so a pseudonym can never be fully anonymous to the
     * person responsible for this site.
     */
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /**
     * Copied from the user at post time rather than joined.
     *
     * If someone changes their screen name, what they already published keeps
     * the name it was published under — otherwise renaming yourself silently
     * rewrites every conversation you have ever been part of, and the replies
     * stop making sense.
     */
    screenName: text("screen_name").notNull(),
    kind: text("kind").notNull().default("story"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Set when moderation removes it. Null is visible. */
    hiddenAt: timestamp("hidden_at"),
    hiddenReason: text("hidden_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("community_posts_user_id_idx").on(table.userId),
    index("community_posts_created_at_idx").on(table.createdAt),
  ],
);

export const communityCommentsTable = pgTable(
  "community_comments",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id")
      .notNull()
      .references(() => communityPostsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    screenName: text("screen_name").notNull(),
    body: text("body").notNull(),
    hiddenAt: timestamp("hidden_at"),
    hiddenReason: text("hidden_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("community_comments_post_id_idx").on(table.postId),
    index("community_comments_user_id_idx").on(table.userId),
  ],
);

/**
 * A report is a row rather than a tally on the post.
 *
 * A count cannot tell you whether eleven reports are eleven people or one
 * person eleven times, and on a site like this the difference decides whether
 * you remove somebody's account of their child's death.
 */
export const communityReportsTable = pgTable(
  "community_reports",
  {
    id: serial("id").primaryKey(),
    /** post | comment */
    targetType: text("target_type").notNull(),
    targetId: integer("target_id").notNull(),
    reporterId: integer("reporter_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    note: text("note"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("community_reports_target_idx").on(table.targetType, table.targetId),
    index("community_reports_reporter_idx").on(table.reporterId),
  ],
);

export const insertCommunityPostSchema = createInsertSchema(
  communityPostsTable,
).omit({
  id: true,
  userId: true,
  screenName: true,
  hiddenAt: true,
  hiddenReason: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCommunityPost = z.infer<typeof insertCommunityPostSchema>;
export type CommunityPost = typeof communityPostsTable.$inferSelect;
export type CommunityComment = typeof communityCommentsTable.$inferSelect;
export type CommunityReport = typeof communityReportsTable.$inferSelect;

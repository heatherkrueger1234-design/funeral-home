import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  keepsakesTable,
  memoriesTable,
  profileTable,
  quotesTable,
  storiesTable,
  usersTable,
} from "@workspace/db";
import {
  CreateKeepsakeBody,
  UpdateKeepsakeBody,
  SetTreasureBody,
} from "@workspace/api-zod";
import { assertHasUpdates, badRequest, parseBody, parseId, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";

/**
 * The small questions, and the door marked "something you wrote".
 *
 * The rule that matters in this file is which tables the resurfacing draw is
 * allowed to touch. The site's own guide tells people to switch off photo
 * memory notifications, because being ambushed by your dead child over
 * breakfast is a different thing from going to look on purpose. If this
 * feature ever pushes, it becomes the thing the guide warns about.
 *
 * So two rules, and the second is the load-bearing one:
 *
 * 1. **It is pulled, never pushed.** There is no notification, no email, and
 *    nothing is returned unless this endpoint is called — which happens when
 *    somebody opens the panel, not when a page loads.
 * 2. **It only ever reads from safe places.** Memories, quotes and songs,
 *    stories other people shared, the small details on the profile, and
 *    keepsakes. It must never read the journal, the letters, or the documents:
 *    that is where the 4am writing lives, and where the autopsy report is
 *    filed. Those tables are not imported into this file, so a future edit
 *    cannot reach them by accident.
 */

const router: IRouter = Router();

// ---------------------------------------------------------- keepsakes -----

router.get("/keepsakes", async (req, res) => {
  const user = currentUser(req);
  const rows = await db
    .select()
    .from(keepsakesTable)
    .where(eq(keepsakesTable.userId, user.id))
    .orderBy(desc(keepsakesTable.createdAt));
  res.json(rows);
});

router.post("/keepsakes", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(CreateKeepsakeBody, req.body);

  const answer = values.answer.trim();
  if (!answer) throw badRequest("An answer can't be empty.");

  // Answering the same prompt again replaces the answer rather than stacking
  // two: the question was asked once, and the second answer is a correction.
  const [existing] = await db
    .select({ id: keepsakesTable.id })
    .from(keepsakesTable)
    .where(
      and(
        eq(keepsakesTable.userId, user.id),
        eq(keepsakesTable.promptId, values.promptId),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(keepsakesTable)
      .set({ answer, question: values.question, updatedAt: new Date() })
      .where(eq(keepsakesTable.id, existing.id))
      .returning();
    res.status(201).json(updated);
    return;
  }

  const [created] = await db
    .insert(keepsakesTable)
    .values({ ...values, answer, userId: user.id })
    .returning();

  res.status(201).json(created);
});

router.put("/keepsakes/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const values = assertHasUpdates(parseBody(UpdateKeepsakeBody.partial(), req.body));

  const [updated] = await db
    .update(keepsakesTable)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(keepsakesTable.id, id), eq(keepsakesTable.userId, user.id)))
    .returning();

  res.json(requireRow(updated, `Keepsake ${id} not found`));
});

router.delete("/keepsakes/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(keepsakesTable)
    .where(and(eq(keepsakesTable.id, id), eq(keepsakesTable.userId, user.id)))
    .returning({ id: keepsakesTable.id });

  requireRow(deleted, `Keepsake ${id} not found`);
  res.status(204).end();
});

// --------------------------------------------------------- resurfacing -----

type Candidate = {
  kind: "memory" | "quote" | "keepsake" | "story" | "detail";
  label: string;
  title: string | null;
  body: string | null;
  imageUrl: string | null;
  sourceId: number | null;
  writtenAt: string | null;
  /** Starred things are drawn more often. Nothing else weights the draw. */
  weight: number;
};

/** The small things on the profile, which are treasures by their nature. */
const PROFILE_DETAILS: { column: keyof typeof profileTable.$inferSelect; label: string }[] = [
  { column: "howTheySmelled", label: "What they smelled like" },
  { column: "whatDroveYouCrazy", label: "What drove you crazy" },
  { column: "favoriteFood", label: "Their favourite food" },
  { column: "favoriteColor", label: "Their favourite colour" },
  { column: "favoriteAnimal", label: "Their favourite animal" },
  { column: "hobbies", label: "What they loved doing" },
  { column: "personality", label: "What they were like" },
];

router.get("/resurface", async (req, res) => {
  const user = currentUser(req);

  if (!user.resurfacingEnabled) {
    res.json({ found: false });
    return;
  }

  const candidates: Candidate[] = [];

  const memories = await db
    .select()
    .from(memoriesTable)
    .where(eq(memoriesTable.userId, user.id));

  for (const memory of memories) {
    candidates.push({
      kind: "memory",
      label: "A memory you saved",
      title: memory.title,
      body: memory.description,
      imageUrl: memory.imageUrl,
      sourceId: memory.id,
      writtenAt: memory.createdAt.toISOString(),
      weight: memory.isStarred ? 4 : 1,
    });
  }

  const quotes = await db
    .select()
    .from(quotesTable)
    .where(eq(quotesTable.userId, user.id));

  for (const quote of quotes) {
    candidates.push({
      kind: "quote",
      label: quote.type === "song" ? "A song you kept" : "Something you wrote down",
      title: quote.author,
      body: quote.text,
      imageUrl: null,
      sourceId: quote.id,
      writtenAt: quote.createdAt.toISOString(),
      weight: quote.isStarred ? 4 : 1,
    });
  }

  const keepsakes = await db
    .select()
    .from(keepsakesTable)
    .where(eq(keepsakesTable.userId, user.id));

  for (const keepsake of keepsakes) {
    candidates.push({
      kind: "keepsake",
      label: keepsake.question,
      title: null,
      body: keepsake.answer,
      imageUrl: null,
      sourceId: keepsake.id,
      writtenAt: keepsake.createdAt.toISOString(),
      // Always weighted: these were written precisely because they were the
      // things most at risk of fading.
      weight: 3,
    });
  }

  const stories = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.userId, user.id));

  for (const story of stories) {
    candidates.push({
      kind: "story",
      label: `Something ${story.authorName} remembered`,
      title: story.title,
      body: story.content,
      imageUrl: story.imageUrl,
      sourceId: story.id,
      writtenAt: story.createdAt.toISOString(),
      weight: 2,
    });
  }

  const [profile] = await db
    .select()
    .from(profileTable)
    .where(eq(profileTable.userId, user.id))
    .limit(1);

  if (profile) {
    for (const detail of PROFILE_DETAILS) {
      const value = profile[detail.column];
      if (typeof value === "string" && value.trim()) {
        candidates.push({
          kind: "detail",
          label: detail.label,
          title: null,
          body: value,
          imageUrl: null,
          sourceId: null,
          writtenAt: null,
          weight: 3,
        });
      }
    }
  }

  if (candidates.length === 0) {
    res.json({ found: false });
    return;
  }

  // A weighted draw, and nothing cleverer. Which of these is a treasure is not
  // a judgement anything here is qualified to make about somebody else's dead
  // child — the only input is what they starred.
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  let ticket = Math.random() * total;
  const chosen =
    candidates.find((c) => (ticket -= c.weight) < 0) ?? candidates[0]!;

  res.json({
    found: true,
    kind: chosen.kind,
    label: chosen.label,
    title: chosen.title,
    body: chosen.body,
    imageUrl: chosen.imageUrl,
    sourceId: chosen.sourceId,
    writtenAt: chosen.writtenAt,
  });
});

// ----------------------------------------------------------- treasures -----

router.post("/treasures", async (req, res) => {
  const user = currentUser(req);
  const values = parseBody(SetTreasureBody, req.body);

  const table = values.kind === "memory" ? memoriesTable : quotesTable;

  const [updated] = await db
    .update(table)
    .set({ isStarred: values.starred })
    .where(and(eq(table.id, values.id), eq(table.userId, user.id)))
    .returning({ id: table.id });

  requireRow(updated, `That ${values.kind} was not found`);
  res.status(204).end();
});

/** The off switch for the door itself. */
router.put("/resurface/settings", async (req, res) => {
  const user = currentUser(req);
  const enabled = (req.body as { enabled?: unknown })?.enabled;
  if (typeof enabled !== "boolean") throw badRequest("`enabled` must be true or false.");

  await db
    .update(usersTable)
    .set({ resurfacingEnabled: enabled, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  res.json({ resurfacingEnabled: enabled });
});

export default router;

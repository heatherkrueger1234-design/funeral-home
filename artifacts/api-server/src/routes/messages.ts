import { Router, type IRouter } from "express";
import { db, caseMessagesTable } from "@workspace/db";
import { PostCaseMessageBody } from "@workspace/api-zod";
import { badRequest, HttpError, parseBody } from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import { buildThread, isThreadLocked, markRead } from "../lib/thread";
import { isWithinOfficeHours } from "../lib/office-hours";
import { loadCase } from "./cases";

const router: IRouter = Router();

router.get("/cases/:caseId/messages", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  const thread = await buildThread({ case: row, home });

  // Opening the thread is what marks the family's messages read; a read
  // receipt failing must not fail the request that produced it.
  void markRead(row.id, "home").catch((err: unknown) => {
    req.log?.warn({ err }, "Could not mark family messages read");
  });

  res.json(thread);
});

router.post("/cases/:caseId/messages", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const values = parseBody(PostCaseMessageBody, req.body);

  const body = values.body.trim();
  if (!body) throw badRequest("A message can't be empty.");

  // The lock protects the director from being pulled back into a case months
  // later, so the director is bound by it too — a thread that only one side
  // can reopen is not closed.
  if (isThreadLocked(row)) {
    throw new HttpError(409, "This conversation has been closed.");
  }

  const now = new Date();

  const [created] = await db
    .insert(caseMessagesTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      authorUserId: user.id,
      body,
      sentOutsideOfficeHours: isWithinOfficeHours(home, now) ? null : now,
    })
    .returning();

  res.status(201).json({
    id: created!.id,
    caseId: created!.caseId,
    body: created!.body,
    authorSide: "home" as const,
    authorName: user.displayName,
    authorTitle: user.title,
    sentOutsideOfficeHours: created!.sentOutsideOfficeHours !== null,
    readAt: created!.readAt,
    createdAt: created!.createdAt,
  });
});

export default router;

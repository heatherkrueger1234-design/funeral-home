import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  caseMemoriesTable,
  familyContactsTable,
  serviceSelectionsTable,
  funeralHomesTable,
} from "@workspace/db";
import {
  CreateCaseMemoryBody,
  UpdateMemoryBody,
  EmailOfficiantBriefBody,
} from "@workspace/api-zod";
import {
  isMailConfigured,
  MailNotSentError,
  sendOfficiantBriefEmail,
} from "@workspace/mailer";
import {
  assertHasUpdates,
  badRequest,
  parseBody,
  parseId,
  requireRow,
} from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import {
  memoriesForCase,
  memoryById,
  nextMemoryPosition,
} from "../lib/memories";
import {
  renderOfficiantBrief,
  renderOfficiantBriefText,
  type BriefInput,
} from "../lib/officiant-brief";
import { loadCase } from "./cases";
import { decedentDisplayName } from "@workspace/db";

const router: IRouter = Router();

router.get("/cases/:caseId/memories", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  res.json(await memoriesForCase(row.id, home.id));
});

router.post("/cases/:caseId/memories", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const body = parseBody(CreateCaseMemoryBody, req.body);

  const kind = body.kind ?? "memory";

  /*
   * Two ways for a director to be the one typing, and they are recorded
   * differently on purpose.
   *
   * With an `authorName` this is a tribute: the director is transcribing
   * something a minister said, and the minister is the author. Without one
   * it is the director's own note of a telephone call, and the director is.
   * Setting both would claim a staff member said the eulogy.
   */
  const named = body.authorName?.trim() || null;

  const [created] = await db
    .insert(caseMemoriesTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      kind,
      prompt: body.prompt?.trim() || null,
      body: body.body.trim(),
      authorName: named,
      authorUserId: named ? null : user.id,
      forOfficiant: body.forOfficiant ?? false,
      position: await nextMemoryPosition(row.id, home.id),
    })
    .returning();

  res.status(201).json(await memoryById(created!.id, home.id));
});

router.put("/memories/:memoryId", async (req, res) => {
  const home = tenant(req);
  const id = parseId(req.params.memoryId);
  const body = assertHasUpdates(parseBody(UpdateMemoryBody, req.body));

  const [updated] = await db
    .update(caseMemoriesTable)
    .set({
      ...(body.body !== undefined ? { body: body.body.trim() } : {}),
      ...(body.authorName !== undefined
        ? { authorName: body.authorName?.trim() || null }
        : {}),
      ...(body.forOfficiant !== undefined
        ? { forOfficiant: body.forOfficiant }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(caseMemoriesTable.id, id),
        eq(caseMemoriesTable.funeralHomeId, home.id),
      ),
    )
    .returning();

  requireRow(updated, "That could not be found.");

  res.json(await memoryById(id, home.id));
});

router.delete("/memories/:memoryId", async (req, res) => {
  const home = tenant(req);
  const id = parseId(req.params.memoryId);

  const [deleted] = await db
    .delete(caseMemoriesTable)
    .where(
      and(
        eq(caseMemoriesTable.id, id),
        eq(caseMemoriesTable.funeralHomeId, home.id),
      ),
    )
    .returning({ id: caseMemoriesTable.id });

  requireRow(deleted, "That could not be found.");

  res.status(204).end();
});

/* ------------------------------------------------- the officiant's brief -- */

/**
 * Everything the sheet needs, in one place.
 *
 * Gathered here rather than in each handler so that the printed page and the
 * emailed one cannot drift — the single worst outcome for this feature would
 * be a minister reading a sheet that says something different from the one
 * the director checked.
 */
async function briefInput(
  req: Parameters<typeof tenant>[0],
  rawCaseId: string | undefined,
  note?: string | null,
): Promise<BriefInput> {
  const home = tenant(req);
  const row = await loadCase(req, rawCaseId);

  const [homeRow] = await db
    .select()
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.id, home.id))
    .limit(1);

  const contacts = await db
    .select()
    .from(familyContactsTable)
    .where(
      and(
        eq(familyContactsTable.caseId, row.id),
        eq(familyContactsTable.funeralHomeId, home.id),
      ),
    )
    .orderBy(asc(familyContactsTable.id));

  const selections = await db
    .select()
    .from(serviceSelectionsTable)
    .where(
      and(
        eq(serviceSelectionsTable.caseId, row.id),
        eq(serviceSelectionsTable.funeralHomeId, home.id),
      ),
    )
    .orderBy(asc(serviceSelectionsTable.position), asc(serviceSelectionsTable.id));

  return {
    case: row,
    home: requireRow(homeRow, "That home could not be found."),
    contacts,
    selections,
    memories: await memoriesForCase(row.id, home.id),
    note: note ?? null,
  };
}

router.get("/cases/:caseId/officiant-brief", async (req, res) => {
  const input = await briefInput(req, req.params.caseId);

  // Served as a document rather than as JSON holding a string: the director
  // opens it in a tab and presses Ctrl-P, which is the whole design.
  res.type("html").send(renderOfficiantBrief(input));
});

router.post("/cases/:caseId/officiant-brief/email", async (req, res) => {
  const body = parseBody(EmailOfficiantBriefBody, req.body);
  const to = body.to.trim();

  if (!to) throw badRequest("Please give an address to send it to.");

  const input = await briefInput(req, req.params.caseId, body.note ?? null);

  /*
   * Answered honestly rather than optimistically, and the two ways it can
   * fail are told apart.
   *
   * A deployment with no SMTP configured logs the brief instead of sending
   * it, which is a reasonable thing for it to do and a terrible thing to
   * describe as "sent" — a director would walk into a service believing the
   * minister had been given something nobody ever posted. A mail server that
   * refuses the message is a different problem with a different fix: one is
   * "this deployment cannot send email at all", the other is usually a
   * mistyped address, and only the second is worth trying again.
   *
   * Neither is a failed request. The director asked to send a brief, the
   * brief exists and is still printable, and answering a 500 to somebody who
   * pressed a button that half-worked tells them nothing they can act on.
   */
  const configured = isMailConfigured();

  try {
    await sendOfficiantBriefEmail({
      to,
      homeName: input.home.name,
      decedentName: decedentDisplayName(input.case),
      html: renderOfficiantBrief(input),
      text: renderOfficiantBriefText(input),
    });
  } catch (error) {
    if (!(error instanceof MailNotSentError)) throw error;

    res.json({
      sent: false,
      to,
      reason: configured
        ? `The mail server would not take it: ${error.message}`
        : "This deployment has no email set up, so nothing was sent. Print it instead, or copy it into your own email.",
    });
    return;
  }

  res.json({ sent: true, to, reason: null });
});

export default router;

import { and, asc, eq } from "drizzle-orm";
import {
  db,
  caseDeadlinesTable,
  caseStatutoryClocksTable,
  caseStatutoryDeadlinesTable,
  timelineTemplatesTable,
  vitalStatisticsTable,
  COLORADO_STATUTORY_DEADLINES,
  DEFAULT_TIMELINE_TEMPLATE,
  describeOffset,
  dueAtFor,
  type Case,
  type CaseStatutoryClock,
  type StatutoryDeadlineTemplate,
  type TimelineTemplate,
} from "@workspace/db";

/**
 * Turning the home's standard schedule into a case's actual timeline.
 *
 * The rule that makes this safe to call whenever: entries already on the
 * timeline are matched **by title** and updated in place rather than
 * duplicated. That matters in two ordinary situations. A director who presses
 * "build the schedule" twice should not get ten items; and when a service is
 * moved from Friday to Monday, every unfinished step should move with it
 * while anything the family has already done stays done.
 *
 * Completed steps are never rescheduled. Telling a daughter who delivered the
 * clothing on Tuesday that it is now due on Thursday would be worse than
 * saying nothing.
 */

export async function templateFor(
  funeralHomeId: number,
): Promise<TimelineTemplate[]> {
  return db
    .select()
    .from(timelineTemplatesTable)
    .where(eq(timelineTemplatesTable.funeralHomeId, funeralHomeId))
    .orderBy(
      asc(timelineTemplatesTable.position),
      asc(timelineTemplatesTable.id),
    );
}

/** The template as the API describes it, with the offset in words. */
export function toTemplateJson(row: TimelineTemplate) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    offsetMinutes: row.offsetMinutes,
    offsetLabel: describeOffset(row.offsetMinutes),
    isEvent: row.isEvent,
    enabled: row.enabled,
    position: row.position,
  };
}

/** Give a newly registered home a schedule it can recognise and edit. */
export async function seedTimelineTemplate(
  funeralHomeId: number,
  tx: Pick<typeof db, "insert"> = db,
): Promise<void> {
  await tx.insert(timelineTemplatesTable).values(
    DEFAULT_TIMELINE_TEMPLATE.map((entry, position) => ({
      funeralHomeId,
      title: entry.title,
      description: entry.description,
      offsetMinutes: entry.offsetMinutes,
      isEvent: entry.isEvent,
      position,
    })),
  );
}

export type ApplyResult = { created: number; moved: number; skipped: number };

/**
 * Build (or rebuild) a case's timeline from the home's standard schedule.
 *
 * Returns counts rather than rows so the caller can say something honest
 * about what changed — "4 added, 1 moved" is a better answer to a director
 * than a silent success.
 */
export async function applyTemplateToCase(
  row: Case,
  now = new Date(),
): Promise<ApplyResult> {
  /*
   * The statutory half first, and it does not wait for a service date.
   *
   * This used to return empty the moment `serviceAt` was null, which was
   * right about the home's own schedule and wrong about the law: Colorado's
   * 72 hours run from taking custody, not from a funeral nobody has booked
   * yet. A case opened on the Tuesday with no date set is exactly the case
   * whose death certificate clock is already running.
   */
  await applyStatutoryDeadlines(row, now);

  // The home's own steps are offsets from the service, so without one there
  // is nothing to measure those from.
  if (!row.serviceAt) return { created: 0, moved: 0, skipped: 0 };

  const template = (await templateFor(row.funeralHomeId)).filter(
    (entry) => entry.enabled,
  );

  if (template.length === 0) return { created: 0, moved: 0, skipped: 0 };

  const existing = await db
    .select()
    .from(caseDeadlinesTable)
    .where(eq(caseDeadlinesTable.caseId, row.id));

  // Matched on the title as the home wrote it. Not an id, because a
  // director may also have typed the same step by hand before pressing this,
  // and ending up with two "Bring clothing to the funeral home" is exactly
  // the mess the feature is supposed to prevent.
  const byTitle = new Map(
    existing.map((entry) => [entry.title.trim().toLowerCase(), entry]),
  );

  const result: ApplyResult = { created: 0, moved: 0, skipped: 0 };

  for (const [index, entry] of template.entries()) {
    const dueAt = dueAtFor(entry, row.serviceAt);
    const match = byTitle.get(entry.title.trim().toLowerCase());

    if (!match) {
      await db.insert(caseDeadlinesTable).values({
        funeralHomeId: row.funeralHomeId,
        caseId: row.id,
        title: entry.title,
        description: entry.description,
        dueAt,
        isEvent: entry.isEvent,
        position: index,
      });
      result.created += 1;
      continue;
    }

    // Already done, or already at the right time: leave it exactly alone.
    if (match.completedAt !== null || match.dueAt.getTime() === dueAt.getTime()) {
      result.skipped += 1;
      continue;
    }

    await db
      .update(caseDeadlinesTable)
      .set({ dueAt, position: index, updatedAt: now })
      .where(eq(caseDeadlinesTable.id, match.id));
    result.moved += 1;
  }

  return result;
}

/**
 * Move an existing timeline when the service itself moves.
 *
 * A funeral being moved is ordinary — a family flying in, a church with a
 * wedding on the Saturday, a coroner who is not finished. What is not
 * ordinary is what used to happen next: the case record said Monday, the
 * family's timeline still said Friday, and the two screens of the same app
 * disagreed about when somebody's mother was being buried. Nothing told the
 * director, because the only thing that rebuilt the timeline was a button
 * they had no reason to press.
 *
 * A shift, not a rebuild from the template, and the difference matters:
 *
 *  - A director who pulled "bring clothing" forward a day for this family
 *    keeps that. Re-applying the template would quietly undo it.
 *  - A step already ticked off is left exactly where it is. Telling a
 *    daughter who delivered the clothing on Tuesday that it is now due on
 *    Thursday would be worse than saying nothing.
 *  - It works for a case whose timeline was never built from the template at
 *    all, which a rebuild does not.
 *
 * Returns how many rows moved, so the caller can say something true.
 */
export async function shiftTimeline(
  caseId: number,
  deltaMs: number,
  now = new Date(),
): Promise<number> {
  if (deltaMs === 0) return 0;

  const rows = await db
    .select()
    .from(caseDeadlinesTable)
    .where(eq(caseDeadlinesTable.caseId, caseId));

  let moved = 0;

  for (const entry of rows) {
    if (entry.completedAt !== null) continue;

    await db
      .update(caseDeadlinesTable)
      .set({ dueAt: new Date(entry.dueAt.getTime() + deltaMs), updatedAt: now })
      .where(eq(caseDeadlinesTable.id, entry.id));
    moved += 1;
  }

  return moved;
}

/* ------------------------------------------------ Colorado's own clock -- */

/**
 * The clock row for a case, created on first sight.
 *
 * Custody is *proposed* as the moment the case was opened rather than left
 * empty. A home opens the case when it takes the call, and the call is
 * usually within an hour or two of collecting the body — so the proposal is
 * right far more often than it is wrong, and `custodyAssumed` says plainly
 * that it is a proposal. An empty field is the one option that reliably
 * produces nothing at all, because nobody fills in a form about a deadline
 * they have not been shown yet.
 */
export async function statutoryClockFor(
  row: Case,
): Promise<CaseStatutoryClock> {
  const [existing] = await db
    .select()
    .from(caseStatutoryClocksTable)
    .where(eq(caseStatutoryClocksTable.caseId, row.id))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(caseStatutoryClocksTable)
    .values({
      funeralHomeId: row.funeralHomeId,
      caseId: row.id,
      custodyTakenAt: row.createdAt,
      custodyAssumed: true,
    })
    // Two requests landing together on a case nobody has opened before.
    .onConflictDoNothing({ target: caseStatutoryClocksTable.caseId })
    .returning();

  if (created) return created;

  const [raced] = await db
    .select()
    .from(caseStatutoryClocksTable)
    .where(eq(caseStatutoryClocksTable.caseId, row.id))
    .limit(1);

  return raced!;
}

/** Whether this case is heading for a cremation, as far as anyone has said. */
async function dispositionIsCremation(caseId: number): Promise<boolean | null> {
  const [vitals] = await db
    .select({ dispositionType: vitalStatisticsTable.dispositionType })
    .from(vitalStatisticsTable)
    .where(eq(vitalStatisticsTable.caseId, caseId))
    .limit(1);

  const stated = vitals?.dispositionType?.trim();
  if (!stated) return null;

  // Free text on the certificate, because that is what the certificate takes.
  return /cremat/i.test(stated);
}

function statutoryDueAt(
  entry: StatutoryDeadlineTemplate,
  row: Case,
  clock: CaseStatutoryClock,
): Date | null {
  if (entry.offsetHours === null) return null;

  const anchoredAt =
    entry.anchor === "custody"
      ? clock.custodyTakenAt
      : entry.anchor === "edrs_request"
        ? clock.edrsRequestedAt
        : entry.anchor === "death"
          ? row.dateOfDeath
          : null;

  if (!anchoredAt) return null;

  return new Date(anchoredAt.getTime() + entry.offsetHours * 3_600_000);
}

/**
 * Put Colorado's deadlines on a case, and keep them current.
 *
 * Idempotent, and called on every read rather than behind a button. These are
 * not a preference a director opted into — they are the law in the state the
 * home operates in, and a home that has to press something to be told about
 * its own 72 hours will be told about them by the registrar instead.
 *
 * Completed and dismissed rows are never touched. Everything else has its
 * date recomputed, so correcting the custody time on the Thursday moves the
 * certificate deadline with it rather than leaving two numbers that disagree.
 */
export async function applyStatutoryDeadlines(
  row: Case,
  now = new Date(),
): Promise<void> {
  // Somebody arranging their own funeral in advance is alive. None of this
  // applies to them, and creating it would be grotesque.
  if (row.kind === "pre_need") return;

  const clock = await statutoryClockFor(row);
  const cremating = await dispositionIsCremation(row.id);

  const existing = await db
    .select()
    .from(caseStatutoryDeadlinesTable)
    .where(eq(caseStatutoryDeadlinesTable.caseId, row.id));

  const byKey = new Map(existing.map((entry) => [entry.key, entry]));

  for (const entry of COLORADO_STATUTORY_DEADLINES) {
    const match = byKey.get(entry.key);

    /*
     * A cremation item on a case nobody has classified yet is created
     * anyway, and the asymmetry is the whole argument. A cremation
     * authorization shown on a burial is one line a director dismisses. A
     * cremation authorization missing on a cremation is a crematory
     * refusing the body on the morning of the service.
     *
     * Once somebody says "burial" on the certificate, it marks itself as not
     * applying rather than vanishing, so the record still shows it was
     * considered.
     */
    const applies = entry.appliesTo === "all" || cremating !== false;

    if (!applies) {
      if (match && match.notApplicableAt === null && match.completedAt === null) {
        await db
          .update(caseStatutoryDeadlinesTable)
          .set({
            notApplicableAt: now,
            notApplicableReason: "This case is recorded as a burial.",
            updatedAt: now,
          })
          .where(eq(caseStatutoryDeadlinesTable.id, match.id));
      }
      continue;
    }

    const dueAt = statutoryDueAt(entry, row, clock);

    if (!match) {
      await db
        .insert(caseStatutoryDeadlinesTable)
        .values({
          funeralHomeId: row.funeralHomeId,
          caseId: row.id,
          key: entry.key,
          title: entry.title,
          description: entry.description,
          citation: entry.citation,
          anchor: entry.anchor,
          dueAt,
        })
        .onConflictDoNothing({
          target: [
            caseStatutoryDeadlinesTable.caseId,
            caseStatutoryDeadlinesTable.key,
          ],
        });
      continue;
    }

    if (match.completedAt !== null || match.notApplicableAt !== null) continue;
    if (match.dueAt?.getTime() === dueAt?.getTime()) continue;

    await db
      .update(caseStatutoryDeadlinesTable)
      .set({ dueAt, updatedAt: now })
      .where(eq(caseStatutoryDeadlinesTable.id, match.id));
  }
}

/** Whether a case has any timeline at all yet. */
export async function hasDeadlines(caseId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: caseDeadlinesTable.id })
    .from(caseDeadlinesTable)
    .where(eq(caseDeadlinesTable.caseId, caseId))
    .limit(1);

  return row !== undefined;
}

import { and, asc, eq } from "drizzle-orm";
import {
  db,
  caseDeadlinesTable,
  timelineTemplatesTable,
  DEFAULT_TIMELINE_TEMPLATE,
  describeOffset,
  dueAtFor,
  type Case,
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
  // Every step is an offset from the service, so without one there is
  // nothing to measure from.
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

/** Whether a case has any timeline at all yet. */
export async function hasDeadlines(caseId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: caseDeadlinesTable.id })
    .from(caseDeadlinesTable)
    .where(eq(caseDeadlinesTable.caseId, caseId))
    .limit(1);

  return row !== undefined;
}

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  caseDeadlinesTable,
  funeralHomesTable,
  timelineTemplatesTable,
  DEFAULT_TIMELINE_TEMPLATE,
  describeOffset,
  dueAtFor,
  type Case,
  type TimelineAnchor,
  type TimelineTemplate,
} from "@workspace/db";
import { minutesInZone } from "./office-hours";

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
    offsetLabel: describeOffset(row.offsetMinutes, anchorOf(row)),
    anchor: anchorOf(row),
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
      anchor: entry.anchor ?? "service",
      position,
    })),
  );
}

function anchorOf(row: Pick<TimelineTemplate, "anchor">): TimelineAnchor {
  return row.anchor === "death" ? "death" : "service";
}

/**
 * Five in the afternoon, the home's time, on the day somebody died.
 *
 * A date of death arrives as a calendar date -- midnight UTC, from a date
 * field -- and measuring "one day after" from midnight UTC would put the
 * step at six the evening *before* in Denver. So the calendar day is read
 * in UTC, which is how it was written, and the working day ends at five
 * wherever the home is.
 */
export function deathAnchor(dateOfDeath: Date, timezone: string): Date {
  const guess = new Date(
    Date.UTC(
      dateOfDeath.getUTCFullYear(),
      dateOfDeath.getUTCMonth(),
      dateOfDeath.getUTCDate(),
      17,
    ),
  );

  let drift = minutesInZone(guess, timezone) - 17 * 60;
  if (drift < -720) drift += 1440;
  if (drift > 720) drift -= 1440;

  return new Date(guess.getTime() - drift * 60_000);
}

export type ApplyResult = { created: number; moved: number; skipped: number };

type Anchors = Partial<Record<TimelineAnchor, Date>>;

async function anchorsFor(
  row: Pick<Case, "funeralHomeId" | "serviceAt" | "dateOfDeath">,
): Promise<Anchors> {
  const anchors: Anchors = {};
  if (row.serviceAt) anchors.service = row.serviceAt;

  if (row.dateOfDeath) {
    const [home] = await db
      .select({ timezone: funeralHomesTable.timezone })
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, row.funeralHomeId))
      .limit(1);
    anchors.death = deathAnchor(row.dateOfDeath, home?.timezone ?? "America/Denver");
  }

  return anchors;
}

/**
 * Build (or rebuild) a case's timeline from the home's standard schedule.
 *
 * Each step is built only once the date it is measured from exists: the
 * service steps when there is a service, the death-certificate steps when
 * there is a date of death. `only` narrows it to one of the two, for the
 * moment one of them has just been filled in.
 *
 * Returns counts rather than rows so the caller can say something honest
 * about what changed — "4 added, 1 moved" is a better answer to a director
 * than a silent success.
 */
export async function applyTemplateToCase(
  row: Case,
  now = new Date(),
  only?: TimelineAnchor,
): Promise<ApplyResult> {
  const result: ApplyResult = { created: 0, moved: 0, skipped: 0 };

  const anchors = await anchorsFor(row);
  // Nothing on a pre-need file counts from a death, because nobody has died.
  if (row.kind === "pre_need") delete anchors.death;

  const template = (await templateFor(row.funeralHomeId)).filter(
    (entry) =>
      entry.enabled &&
      anchors[anchorOf(entry)] !== undefined &&
      (only === undefined || anchorOf(entry) === only),
  );

  if (template.length === 0) return result;

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

  for (const entry of template) {
    const anchor = anchorOf(entry);
    const dueAt = dueAtFor(entry, anchors[anchor]!);
    const match = byTitle.get(entry.title.trim().toLowerCase());

    if (!match) {
      await db.insert(caseDeadlinesTable).values({
        funeralHomeId: row.funeralHomeId,
        caseId: row.id,
        title: entry.title,
        description: entry.description,
        dueAt,
        isEvent: entry.isEvent,
        anchor,
        position: entry.position,
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
      .set({ dueAt, anchor, position: entry.position, updatedAt: now })
      .where(eq(caseDeadlinesTable.id, match.id));
    result.moved += 1;
  }

  return result;
}

/**
 * Keep the timeline in step after either date on a case changes.
 *
 * Called with the case before and after an edit, by whichever side made
 * it. Three situations, and each is handled the way a director would by
 * hand if they remembered to:
 *
 *  - A date appears for the first time: build the steps that count from it.
 *    Skipped for the service when the director has already typed their own
 *    timeline, so the standard schedule never lands on top of hand work.
 *  - A date moves: every unfinished step that was built from it moves by
 *    exactly the same amount. By the difference rather than by rebuilding,
 *    so a step a director nudged by hand keeps its nudge. Done steps stay
 *    put -- telling a daughter who delivered the clothing on Tuesday that it
 *    is now due Thursday would be worse than saying nothing.
 *  - A date is cleared: nothing moves. An empty field is more often a slip
 *    than a cancelled funeral, and deleting the family's timeline on a slip
 *    is not recoverable.
 */
export async function rescheduleCase(
  before: Case,
  after: Case,
  now = new Date(),
): Promise<void> {
  const moves: Array<[TimelineAnchor, Date | null, Date | null]> = [
    ["service", before.serviceAt, after.serviceAt],
    ["death", before.dateOfDeath, after.dateOfDeath],
  ];

  for (const [anchor, was, is] of moves) {
    if (is === null) continue;

    if (was === null) {
      if (anchor === "service" && (await hasHandMadeDeadlines(after.id))) {
        continue;
      }
      await applyTemplateToCase(after, now, anchor);
      continue;
    }

    if (was.getTime() === is.getTime()) continue;

    // For a death date the two anchors are compared, not the raw dates, so
    // the move is whole days in the home's own time.
    const [from, to] =
      anchor === "death"
        ? [
            (await anchorsFor({ ...before, serviceAt: null })).death!,
            (await anchorsFor({ ...after, serviceAt: null })).death!,
          ]
        : [was, is];
    const shift = to.getTime() - from.getTime();
    if (shift === 0) continue;

    await db
      .update(caseDeadlinesTable)
      .set({
        dueAt: sql`${caseDeadlinesTable.dueAt} + make_interval(secs => ${shift / 1000})`,
        updatedAt: now,
      })
      .where(
        and(
          eq(caseDeadlinesTable.caseId, after.id),
          eq(caseDeadlinesTable.anchor, anchor),
          isNull(caseDeadlinesTable.completedAt),
        ),
      );
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

/** Whether a director has typed any of this case's timeline themselves. */
async function hasHandMadeDeadlines(caseId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: caseDeadlinesTable.id })
    .from(caseDeadlinesTable)
    .where(
      and(
        eq(caseDeadlinesTable.caseId, caseId),
        isNull(caseDeadlinesTable.anchor),
      ),
    )
    .limit(1);

  return row !== undefined;
}

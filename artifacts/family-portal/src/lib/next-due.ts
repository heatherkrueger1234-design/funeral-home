/**
 * The one thing the hub's "Next" card shows, from the timeline.
 *
 * It is the soonest thing still *ahead*, not simply the earliest thing not
 * ticked. Those used to be the same line of code, and the effect was that
 * anything whose date had slipped by -- often something the funeral home
 * was quietly dealing with itself -- sat at the top of the family's front
 * page under yesterday's date, looking like a reprimand, for as long as
 * nobody ticked it. What has slipped is still counted, so the hub can say
 * so once, in words. Only when nothing is left ahead does a slipped item
 * take the card itself.
 *
 * Events (the service itself) are never "next": they are not things to do.
 */
export type TimelineEntry = {
  dueAt: string | Date;
  isEvent: boolean;
  completedAt: string | Date | null;
};

export function nextDue<T extends TimelineEntry>(
  entries: readonly T[],
  now: number = Date.now(),
): { next: T | undefined; ahead: boolean; slipped: T[] } {
  const time = (entry: T) => new Date(entry.dueAt).getTime();
  const open = entries
    .filter((entry) => !entry.isEvent && entry.completedAt === null)
    .sort((a, b) => time(a) - time(b));

  const slipped = open.filter((entry) => time(entry) < now);
  const upcoming = open.find((entry) => time(entry) >= now);

  return upcoming
    ? { next: upcoming, ahead: true, slipped }
    : { next: slipped[0], ahead: false, slipped };
}

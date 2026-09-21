import { cn } from "@/lib/api";
import type { LicensureReminder, ReminderStanding } from "@/lib/api";

/**
 * The calm reminders.
 *
 * This component is where Section 2 of `COLORADO.md` either becomes the most
 * useful screen in the product or becomes a nagging dashboard, and the
 * difference is entirely tone. So, three rules, and they are not preferences:
 *
 *  - **Nothing is red.** `--destructive` is for confirming a destructive
 *    action. A licence that expires in three weeks is not a destructive
 *    action; it is a thing to do, and the warm clay of `--notice` says so
 *    without implying anybody has failed.
 *  - **Nothing counts down.** "in about 4 months" and "in 17 days", never
 *    "17 days left" and never a timer. The wording comes from `describeWhen`
 *    in the schema, so the server and this screen cannot drift apart on it.
 *  - **Nothing is a badge.** A count in a coloured pill is a score, and a
 *    score is a thing somebody is losing at.
 *
 * What is left is a list of sentences, in order, each of which says what is
 * true and what would fix it.
 */

const STANDING_COPY: Record<ReminderStanding, string> = {
  passed: "Already passed",
  soon: "Coming up",
  ahead: "In hand",
  settled: "In hand",
};

export function Reminders({
  reminders,
  emptyDetail,
}: {
  reminders: LicensureReminder[];
  /** What "nothing to say" means here, in this home's context. */
  emptyDetail: string;
}) {
  if (reminders.length === 0) {
    return (
      <p className="max-w-prose text-sm leading-relaxed text-[var(--muted-foreground)]">
        {emptyDetail}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {reminders.map((reminder) => {
        const attention = reminder.standing === "passed" || reminder.standing === "soon";

        return (
          <li
            key={reminder.key}
            className={cn(
              "border-l-2 py-0.5 pl-4",
              attention
                ? "border-[var(--notice)]"
                : "border-[var(--border)]",
            )}
          >
            <p
              className={cn(
                "eyebrow mb-0.5",
                attention && "text-[var(--notice)]",
              )}
            >
              {STANDING_COPY[reminder.standing]}
            </p>
            <p className="max-w-prose font-medium">{reminder.summary}</p>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-[var(--muted-foreground)]">
              {reminder.detail}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

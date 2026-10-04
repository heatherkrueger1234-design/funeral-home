import {
  formatDate,
  formatDateTime,
  type PlatformOverview,
} from "@/lib/api";

/**
 * Each thing stopping a message from reaching somebody, as one plain
 * sentence. Empty when all is well, and the overview says so in one quiet
 * line rather than drawing a card.
 */
export function deliveryProblems(
  delivery: PlatformOverview["delivery"],
): string[] {
  const problems: string[] = [];

  if (!delivery.mailConfigured) {
    problems.push(
      "Mail is not set up on this deployment. Aftercare check-ins, trial reminders and password resets are being written to the server log instead of sent.",
    );
  }

  if (delivery.aftercareFailedLast30Days > 0) {
    problems.push(
      `${delivery.aftercareFailedLast30Days} aftercare ${delivery.aftercareFailedLast30Days === 1 ? "check-in" : "check-ins"} at ${delivery.homesWithFailures} ${delivery.homesWithFailures === 1 ? "home" : "homes"} could not be sent in the last thirty days, most recently ${formatDateTime(delivery.lastFailureAt)}.`,
    );
  }

  if (!delivery.smsConfigured) {
    problems.push(
      "Text messages are not set up, so directors are handed each family link to send themselves.",
    );
  }

  return problems;
}

/** A trial worth a call: when it ends, or that it ended and nobody subscribed. */
export function trialSentence(trialEndsAt: string, now: number): string {
  return new Date(trialEndsAt).getTime() <= now
    ? `Trial ended ${formatDate(trialEndsAt)}, not subscribed.`
    : `Trial ends ${formatDate(trialEndsAt)}.`;
}

/**
 * A home gone quiet: the server's own sentence, and the date of the last
 * case when that is the point -- the server sends one only when the reason
 * is a month without a case.
 */
export function quietSentence(reason: string, lastCaseAt: string | null): string {
  return lastCaseAt ? `${reason} The last was ${formatDate(lastCaseAt)}.` : reason;
}

/**
 * The licensure list, in two: homes with a clock actually running get a card
 * each, and homes whose only reminder is that nobody is listed yet share one
 * line. See `Attention` on the overview for why.
 */
export function splitAttention<
  T extends { reminders: ReadonlyArray<{ key: string }> },
>(attention: readonly T[]): { running: T[]; notStarted: T[] } {
  return {
    running: attention.filter((entry) =>
      entry.reminders.some((reminder) => reminder.key !== "deadline-nobody-listed"),
    ),
    notStarted: attention.filter((entry) =>
      entry.reminders.every((reminder) => reminder.key === "deadline-nobody-listed"),
    ),
  };
}

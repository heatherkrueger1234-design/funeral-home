import { describe, expect, it } from "vitest";
import type { LicensureReminder } from "./api";
import {
  deliveryProblems,
  quietSentence,
  splitAttention,
  trialSentence,
} from "./overview";

describe("whether the mail is getting out", () => {
  const working = {
    mailConfigured: true,
    smsConfigured: true,
    aftercareFailedLast30Days: 0,
    homesWithFailures: 0,
    lastFailureAt: null,
  };

  it("has nothing to say when everything is working", () => {
    // A green tick on every visit trains the eye to skip the card on the day
    // it matters, so all being well is one quiet line, not a card.
    expect(deliveryProblems(working)).toEqual([]);
  });

  it("says each thing that is wrong in its own sentence, counted properly", () => {
    const problems = deliveryProblems({
      mailConfigured: false,
      smsConfigured: false,
      aftercareFailedLast30Days: 1,
      homesWithFailures: 1,
      lastFailureAt: "2026-09-14T16:02:11.500Z",
    });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/^Mail is not set up on this deployment\./);
    expect(problems[1]).toMatch(
      /^1 aftercare check-in at 1 home could not be sent in the last thirty days, most recently September 14, 2026/,
    );
    expect(problems[2]).toMatch(/^Text messages are not set up/);

    expect(
      deliveryProblems({
        ...working,
        aftercareFailedLast30Days: 5,
        homesWithFailures: 2,
        lastFailureAt: "2026-09-14T16:02:11.500Z",
      }),
    ).toEqual([expect.stringMatching(/^5 aftercare check-ins at 2 homes /)]);
  });
});

describe("who is worth a call", () => {
  const now = Date.parse("2026-10-04T18:00:00.000Z");

  it("says when a trial ends, or that it ended and nobody subscribed", () => {
    expect(trialSentence("2026-10-09T18:00:00.000Z", now)).toBe(
      "Trial ends October 9, 2026.",
    );
    expect(trialSentence("2026-09-30T18:00:00.000Z", now)).toBe(
      "Trial ended September 30, 2026, not subscribed.",
    );
    // A trial ending this very moment has ended: the home cannot open a case.
    expect(trialSentence(new Date(now).toISOString(), now)).toMatch(
      /^Trial ended /,
    );
  });

  it("dates a trial's end and the last case by the evening they fell on here", () => {
    // Nine in the evening in Denver is already the next day in Greenwich,
    // and the home's own page, which reads it here, says the earlier day.
    expect(trialSentence("2026-10-09T03:00:00.000Z", now)).toBe(
      "Trial ends October 8, 2026.",
    );
    expect(trialSentence("2026-10-01T03:00:00.000Z", now)).toBe(
      "Trial ended September 30, 2026, not subscribed.",
    );
    expect(
      quietSentence(
        "No case opened in the last thirty days.",
        "2026-08-04T02:30:00.000Z",
      ),
    ).toBe("No case opened in the last thirty days. The last was August 3, 2026.");
  });

  it("names the last case only when the reason is about cases", () => {
    expect(quietSentence("Family links sent, and none opened yet.", null)).toBe(
      "Family links sent, and none opened yet.",
    );
    expect(
      quietSentence(
        "No case opened in the last thirty days.",
        "2026-08-03T18:00:00.000Z",
      ),
    ).toBe("No case opened in the last thirty days. The last was August 3, 2026.");
  });
});

describe("the Colorado licensure list", () => {
  const reminder = (key: string): LicensureReminder => ({
    key,
    summary: "",
    detail: "",
    standing: "soon",
  });
  const nobodyListed = reminder("deadline-nobody-listed");

  it("gives a home with a clock running its own card, and the homes nobody has started on one line", () => {
    // The same "nobody is listed yet" paragraph once per home is a wall that
    // buries the one home with an amendment due on Thursday.
    const amendmentDue = { name: "Willow Creek", reminders: [reminder("amended-registration")] };
    const notStarted = { name: "Cedar & Stone", reminders: [nobodyListed] };
    const both = { name: "Hartley & Sons", reminders: [nobodyListed, reminder("expiry-7")] };

    expect(splitAttention([amendmentDue, notStarted, both])).toEqual({
      running: [amendmentDue, both],
      notStarted: [notStarted],
    });
  });
});

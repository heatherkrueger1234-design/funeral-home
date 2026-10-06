import { describe, expect, it } from "vitest";
import type { FamilyContact } from "@workspace/api-client-react";
import { keepLabel, passedOnFrom, passedOnSentence, stoppedTooSentence } from "./passed-on";

/**
 * Stopping or replacing a link stops the links it was passed on to as well,
 * so the confirmation has to name those people before the director answers.
 * What is pinned here is that it names the right ones, and says so plainly.
 */

const now = new Date("2026-10-05T12:00:00Z");
const later = "2026-12-01T00:00:00.000Z";
const earlier = "2026-10-01T00:00:00.000Z";

function contact(
  id: number,
  name: string,
  invitedByContactId: number | null,
  overrides: Partial<FamilyContact> = {},
): FamilyContact {
  return {
    id,
    caseId: 1,
    name,
    relationship: null,
    phone: null,
    email: null,
    role: "contributor",
    canInvite: false,
    isSubject: false,
    expiresAt: later,
    revokedAt: null,
    firstSeenAt: null,
    lastSeenAt: null,
    invitedByContactId,
    smsConsentAt: null,
    smsConsentSource: null,
    smsOptedOutAt: null,
    createdAt: earlier,
    ...overrides,
  };
}

const anne = contact(1, "Anne Hale", null, { role: "next_of_kin", canInvite: true });
const mark = contact(2, "Mark Hale", 1);
const joan = contact(3, "Joan Hale", 1);
const bob = contact(4, "Bob Hale", null, { canInvite: true });
const jo = contact(5, "Jo Hale", 4);
const family = [anne, mark, joan, bob, jo];

const names = (found: ReturnType<typeof passedOnFrom>) =>
  found.map((each) => each.contact.name);

describe("whose links go with this one", () => {
  it("is the links this person passed on, and nobody else's", () => {
    expect(names(passedOnFrom(anne, family, now))).toEqual(["Mark Hale", "Joan Hale"]);
    expect(names(passedOnFrom(bob, family, now))).toEqual(["Jo Hale"]);
    expect(passedOnFrom(mark, family, now)).toEqual([]);
  });

  it("follows the link on, through a relative the home let add family", () => {
    const sam = contact(6, "Sam Hale", 2);
    const found = passedOnFrom(anne, [...family, sam], now);
    expect(names(found)).toEqual(["Mark Hale", "Joan Hale", "Sam Hale"]);
    expect(found.map((each) => each.from.name)).toEqual(["Anne Hale", "Anne Hale", "Mark Hale"]);
  });

  it("names only links still working, but follows on past one already stopped", () => {
    const stoppedMark = { ...mark, revokedAt: earlier };
    const expiredJoan = { ...joan, expiresAt: earlier };
    const sam = contact(6, "Sam Hale", 2);
    expect(names(passedOnFrom(anne, [anne, stoppedMark, expiredJoan, sam], now))).toEqual([
      "Sam Hale",
    ]);
  });

  it("cannot be sent round in a circle", () => {
    const one = contact(1, "One", 2);
    const two = contact(2, "Two", 1);
    expect(names(passedOnFrom(one, [one, two], now))).toEqual(["Two"]);
  });
});

describe("what the confirmation says", () => {
  it("names the people, and who passed each link on", () => {
    expect(passedOnSentence(passedOnFrom(anne, family, now))).toBe(
      "This also stops the links Anne Hale passed on to Mark Hale and Joan Hale.",
    );
    expect(passedOnSentence(passedOnFrom(bob, family, now))).toBe(
      "This also stops the link Bob Hale passed on to Jo Hale.",
    );
    const sam = contact(6, "Sam Hale", 2);
    expect(passedOnSentence(passedOnFrom(anne, [...family, sam], now))).toBe(
      "This also stops the links Anne Hale passed on to Mark Hale and Joan Hale, " +
        "and the one Mark Hale passed on to Sam Hale.",
    );
  });

  it("offers to keep them in the words a director would use", () => {
    expect(keepLabel(passedOnFrom(anne, family, now))).toBe(
      "Mark Hale and Joan Hale are family. Keep their links working.",
    );
    expect(keepLabel(passedOnFrom(bob, family, now))).toBe(
      "Jo Hale is family. Keep their link working.",
    );
  });

  it("says afterwards whose links stopped, from what the server did", () => {
    expect(stoppedTooSentence([])).toBeNull();
    expect(stoppedTooSentence([{ id: 2, name: "Mark Hale" }])).toBe(
      "Mark Hale's link stopped too.",
    );
    expect(
      stoppedTooSentence([
        { id: 2, name: "Mark Hale" },
        { id: 3, name: "Joan Hale" },
        { id: 6, name: "Sam Hale" },
      ]),
    ).toBe("Mark Hale's, Joan Hale's, and Sam Hale's links stopped too.");
  });
});

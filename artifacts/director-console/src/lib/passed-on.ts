import type { FamilyContact, StoppedLink } from "@workspace/api-client-react";

/**
 * Whose links go with this one.
 *
 * Stopping or replacing somebody's link stops the links it was passed on to
 * as well, and any passed on from those, because the usual reason for doing
 * it is that the link reached a stranger -- who may already have given
 * themselves one of their own (`routes/contacts.ts` on the server). The
 * server decides what stops and says so in `alsoStopped`. This walks the
 * same family list the panel already holds, so the question can name the
 * people before the director answers it.
 */

/** A relative's link that would stop, and whose it was passed on from. */
export type PassedOn = { contact: FamilyContact; from: FamilyContact };

function isWorking(contact: FamilyContact, now: Date): boolean {
  return contact.revokedAt === null && new Date(contact.expiresAt) > now;
}

/**
 * Every link that came from this contact's, however many steps on, that
 * still works -- nearest first. A link already stopped is walked through
 * rather than round, as the server does: what was passed on from it came
 * from this one too.
 */
export function passedOnFrom(
  contact: FamilyContact,
  contacts: FamilyContact[],
  now = new Date(),
): PassedOn[] {
  const reached = new Set([contact.id]);
  const from = [contact];
  const found: PassedOn[] = [];

  while (from.length > 0) {
    const giver = from.shift()!;
    for (const other of contacts) {
      if (other.invitedByContactId !== giver.id || reached.has(other.id)) continue;
      reached.add(other.id);
      from.push(other);
      if (isWorking(other, now)) found.push({ contact: other, from: giver });
    }
  }

  return found;
}

const list = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });

/**
 * "This also stops the links Anne Hale passed on to Mark Hale and Joan Hale,
 * and the one Mark Hale passed on to Sam Hale."
 */
export function passedOnSentence(passedOn: PassedOn[]): string {
  const groups = new Map<number, { from: FamilyContact; to: string[] }>();
  for (const { contact, from } of passedOn) {
    const group = groups.get(from.id) ?? { from, to: [] };
    group.to.push(contact.name);
    groups.set(from.id, group);
  }

  const phrases = [...groups.values()].map(({ from, to }, index) => {
    const what =
      index === 0
        ? to.length === 1
          ? "the link"
          : "the links"
        : to.length === 1
          ? "the one"
          : "the ones";
    return `${what} ${from.name} passed on to ${list.format(to)}`;
  });

  // Joined by hand: each phrase has its own "and" inside it already, and a
  // list formatter would run two of them together without a comma.
  const joined =
    phrases.length === 1
      ? phrases[0]
      : `${phrases.slice(0, -1).join(", ")}, and ${phrases.at(-1)}`;
  return `This also stops ${joined}.`;
}

/** The way out, for a director who knows who has them. */
export function keepLabel(passedOn: PassedOn[]): string {
  const who = list.format(passedOn.map(({ contact }) => contact.name));
  return passedOn.length === 1
    ? `${who} is family. Keep their link working.`
    : `${who} are family. Keep their links working.`;
}

/** What the server says it stopped, afterwards; null when it stopped nothing else. */
export function stoppedTooSentence(stopped: StoppedLink[]): string | null {
  if (stopped.length === 0) return null;
  const whose = list.format(stopped.map(({ name }) => `${name}'s`));
  return `${whose} ${stopped.length === 1 ? "link" : "links"} stopped too.`;
}

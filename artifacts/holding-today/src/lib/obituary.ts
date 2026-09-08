import type { Obituary } from "@workspace/api-client-react";

/**
 * Assembling the answers into something that reads like an obituary.
 *
 * Deliberately plain and deliberately incomplete. The generated text is a
 * starting point to edit, not a finished thing to publish — a parent should
 * never feel that a form wrote their child's obituary. So it uses the words
 * they typed, joins them with the least connective tissue that will scan, and
 * leaves out anything they did not fill in rather than inventing filler.
 *
 * The cause of death is included only if they wrote one. An obituary does not
 * have to name a cause, most do not, and no default here should imply
 * otherwise.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `2026-04-01` → `1 April 2026`. Anything unparseable is passed through. */
function longDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value.trim() || null;

  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1];
  return name ? `${Number(day)} ${name} ${year}` : value;
}

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** Ends a sentence without doubling punctuation the writer already added. */
function sentence(text: string): string {
  return /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

export function composeObituary(draft: Obituary): string {
  const name = clean(draft.fullName) ?? "Their name";
  const nickname = clean(draft.nickname);
  const born = longDate(draft.bornDate);
  const died = longDate(draft.diedDate);
  const bornPlace = clean(draft.bornPlace);
  const diedPlace = clean(draft.diedPlace);
  const cause = clean(draft.causeOfDeath);

  const paragraphs: string[] = [];

  // Opening: the name, the dates, and the places, in whatever combination
  // was actually answered.
  let opening = nickname ? `${name}, known to everyone as ${nickname},` : `${name}`;

  if (died) {
    opening += ` died on ${died}`;
    if (diedPlace) opening += ` in ${diedPlace}`;
  } else {
    opening += " has died";
  }
  if (cause) opening += `, ${cause}`;
  paragraphs.push(sentence(opening));

  if (born) {
    paragraphs.push(
      sentence(
        bornPlace
          ? `${nickname ?? name} was born on ${born} in ${bornPlace}`
          : `${nickname ?? name} was born on ${born}`,
      ),
    );
  }

  for (const part of [
    clean(draft.lifeDetails),
    clean(draft.personality),
    clean(draft.hobbies),
  ]) {
    if (part) paragraphs.push(part);
  }

  const survived = clean(draft.survivedBy);
  const preceded = clean(draft.precededBy);
  if (survived) paragraphs.push(sentence(`${nickname ?? name} is survived by ${survived}`));
  if (preceded) paragraphs.push(sentence(`They were preceded in death by ${preceded}`));

  const service = clean(draft.serviceDetails);
  if (service) paragraphs.push(service);

  const donations = clean(draft.donations);
  if (donations) paragraphs.push(sentence(`In lieu of flowers, ${donations}`));

  const additional = clean(draft.additional);
  if (additional) paragraphs.push(additional);

  return paragraphs.join("\n\n");
}

/** What the composed text will be, or what is already there if it was edited. */
export function obituaryText(draft: Obituary): string {
  return clean(draft.finalText) ?? composeObituary(draft);
}

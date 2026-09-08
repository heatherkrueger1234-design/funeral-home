import type { ObituaryDraft } from "@workspace/db";

/**
 * Compose an obituary draft from the fields the family filled in.
 *
 * Deliberately a template rather than a language model. Three reasons, and
 * the third is the one that settles it:
 *
 *  1. Every sentence here is printed, read aloud, and kept in a drawer for
 *     forty years. A fluent invention in the middle of it — a war that was
 *     not served in, a town that was not lived in — is not a bug report, it
 *     is a family's permanent record of their mother, wrong.
 *  2. The output has to be predictable enough that a director can skim it
 *     rather than proofread it. That is the time saving.
 *  3. The hard part was never the prose. It was collecting the facts from
 *     six relatives by text message, which is what the form does.
 *
 * So this joins what it was given, in the order obituaries conventionally
 * run, and leaves out any paragraph it has no facts for. Blank in, blank
 * out; nothing is inferred and nothing is embellished. The director edits
 * from there, which is what they were always going to do.
 */

type Fields = Pick<
  ObituaryDraft,
  | "fullName"
  | "bornOn"
  | "birthPlace"
  | "diedOn"
  | "deathPlace"
  | "survivedBy"
  | "precededBy"
  | "biography"
  | "inLieuOfFlowers"
  | "specialThanks"
>;

const clean = (value: string | null | undefined): string =>
  (value ?? "").trim();

/** Ends a clause with a full stop unless it already ends in punctuation. */
function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function composeObituary(fields: Fields): string {
  const name = clean(fields.fullName);
  const bornOn = clean(fields.bornOn);
  const birthPlace = clean(fields.birthPlace);
  const diedOn = clean(fields.diedOn);
  const deathPlace = clean(fields.deathPlace);

  const paragraphs: string[] = [];

  /* The opening: who, and when they died. */
  const opening: string[] = [];
  if (name && diedOn) {
    opening.push(
      deathPlace
        ? `${name} died on ${diedOn}, at ${deathPlace}`
        : `${name} died on ${diedOn}`,
    );
  } else if (name) {
    opening.push(name);
  }

  if (bornOn) {
    opening.push(
      birthPlace
        ? `They were born on ${bornOn} in ${birthPlace}`
        : `They were born on ${bornOn}`,
    );
  } else if (birthPlace) {
    opening.push(`They were born in ${birthPlace}`);
  }

  if (opening.length > 0) {
    paragraphs.push(opening.map(sentence).join(" "));
  }

  /* The life. Kept as the family wrote it — this is the part that is
   * actually theirs, and rewriting it would be the one unforgivable edit. */
  const biography = clean(fields.biography);
  if (biography) paragraphs.push(biography);

  const precededBy = clean(fields.precededBy);
  if (precededBy) paragraphs.push(sentence(`Preceded in death by ${precededBy}`));

  const survivedBy = clean(fields.survivedBy);
  if (survivedBy) paragraphs.push(sentence(`Survived by ${survivedBy}`));

  const thanks = clean(fields.specialThanks);
  if (thanks) paragraphs.push(sentence(`The family wishes to thank ${thanks}`));

  const flowers = clean(fields.inLieuOfFlowers);
  if (flowers) paragraphs.push(sentence(`In lieu of flowers, ${flowers}`));

  return paragraphs.join("\n\n");
}

/**
 * Which person this portal is talking about, and therefore how it talks.
 *
 * A pre-need file is the same collaboration as an at-need one — the same
 * photographs, the same obituary fields, the same hymns — pointed at somebody
 * who is alive and well and arranging their own funeral. Every screen that
 * says "the deceased", offers condolence, or labels a field "date of death"
 * has to know the difference first.
 *
 * Getting it wrong is not a cosmetic bug. It means sending a sympathy line to
 * a person sitting at their own kitchen table in good health, about
 * themselves. That is the single worst thing this product could do to someone
 * who trusted it with their own arrangements, so the check is a named helper
 * rather than an inline `=== "pre_need"` that somebody forgets.
 */
export type CaseVoice = {
  /** True when the person this file is about is still living. */
  preNeed: boolean;
  /** "Eleanor Vance", or "Your plan" when they are reading about themselves. */
  heading: (displayName: string) => string;
  /** What the header strapline says under the home's name. */
  strapline: (displayName: string) => string;
  /** Whose photographs, obituary, wishes these are. */
  possessive: (displayName: string) => string;

  /*
   * The person as a pronoun, for a label or a sentence about them: "they"
   * when they have died, "you" when they are the one reading. The
   * capitalised forms begin a label — `${voice.Their} hair`.
   *
   * Only the pronoun, on purpose. Where the tense changes too, the page
   * writes both sentences out: "Where they lived" is "Where you live", not
   * "Where you lived", because a living person's life is not in the past
   * tense, and no helper here should be able to put it there.
   */
  /** "they", or "you": the subject of a sentence. */
  they: string;
  /** "them", or "you": the object of one. */
  them: string;
  /** "their", or "your". */
  their: string;
  /** "They", or "You", to begin a label or a sentence. */
  They: string;
  /** "Their", or "Your", to begin a label or a sentence. */
  Their: string;
};

export function voiceFor(kind: string | undefined): CaseVoice {
  const preNeed = kind === "pre_need";

  return {
    preNeed,
    heading: (displayName) => (preNeed ? "Your plan" : displayName),
    strapline: (displayName) =>
      preNeed ? `${displayName}'s plan` : `For ${displayName}`,
    possessive: (displayName) => (preNeed ? "your" : `${displayName}'s`),
    they: preNeed ? "you" : "they",
    them: preNeed ? "you" : "them",
    their: preNeed ? "your" : "their",
    They: preNeed ? "You" : "They",
    Their: preNeed ? "Your" : "Their",
  };
}

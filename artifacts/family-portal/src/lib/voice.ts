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
 *
 * And a plan is not always read by the planner. Their daughter, invited to
 * help, is reading about her mother: alive, so nothing in the past tense, but
 * not "you" either — "your plan" would be telling her about her own funeral.
 * So there are three people a page can be speaking about:
 *
 *  - `self`: the planner, reading their own plan. "Where you live."
 *  - `living`: somebody else's plan, read by their family. "Where they live."
 *  - `died`: an at-need file. "Where they lived."
 */
export type Person = "self" | "living" | "died";

export type CaseVoice = {
  /** True when the person this file is about is still living. */
  preNeed: boolean;
  /** True when the reader is that person: a planner reading their own plan. */
  self: boolean;
  /** Who the page is about, as seen by the person reading it. */
  person: Person;
  /**
   * The page writes each sentence out in full, once for each of the three,
   * and this picks the one for the reader. A sentence whose tense changes is
   * never assembled out of parts: "Where they lived" is "Where they live" on
   * a plan, and no helper should be able to put a living person's life in
   * the past tense.
   */
  say: <T>(lines: Record<Person, T>) => T;
  /** "Eleanor Vance", "Eleanor Vance's plan", or "Your plan" when they are
   * reading about themselves. */
  heading: (displayName: string) => string;
  /** What the header strapline says under the home's name. */
  strapline: (displayName: string) => string;
  /** Whose photographs, obituary, wishes these are. */
  possessive: (displayName: string) => string;

  /*
   * The person as a pronoun, for a label or a sentence about them: "they"
   * for somebody else, "you" when they are the one reading. The capitalised
   * forms begin a label — `${voice.Their} hair`.
   *
   * Only the pronoun, on purpose: where the tense changes too, use `say`.
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

/**
 * `isSubject` is the contact's own flag from the session: whether the person
 * reading is the person the plan is for. It only counts on a plan — nobody
 * reads about their own death — and anything missing or unknown falls to the
 * third person, so a relative is never told "your plan" by default.
 */
export function voiceFor(
  kind: string | undefined,
  isSubject?: boolean,
): CaseVoice {
  const preNeed = kind === "pre_need";
  const self = preNeed && isSubject === true;
  const person: Person = self ? "self" : preNeed ? "living" : "died";

  return {
    preNeed,
    self,
    person,
    say: (lines) => lines[person],
    heading: (displayName) =>
      self ? "Your plan" : preNeed ? `${displayName}'s plan` : displayName,
    strapline: (displayName) =>
      preNeed ? `${displayName}'s plan` : `For ${displayName}`,
    possessive: (displayName) => (self ? "your" : `${displayName}'s`),
    they: self ? "you" : "they",
    them: self ? "you" : "them",
    their: self ? "your" : "their",
    They: self ? "You" : "They",
    Their: self ? "Your" : "Their",
  };
}

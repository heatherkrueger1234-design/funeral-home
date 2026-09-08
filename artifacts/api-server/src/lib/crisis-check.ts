/**
 * Noticing when a post is somebody in danger rather than somebody sharing.
 *
 * This is not moderation and it does not block anything. On a site for
 * bereaved parents, a post that says "I can't do this any more" is one of the
 * most likely posts there is, and it is not a rule violation — it is the
 * reason the site exists. Blocking it would teach the person that saying it
 * out loud gets them silenced.
 *
 * So the only thing this does is tell the caller to put the crisis numbers in
 * front of the author before they publish, and to flag the post for a human to
 * look at soon. The post still goes up.
 *
 * Deliberately crude. A phrase list will miss things and will fire on things
 * that turn out to be fine, and both of those are acceptable: the cost of a
 * false positive is that somebody is shown a phone number they did not need,
 * and the cost of a miss is that the post reads like any other. Neither is
 * made better by trying to be clever, and a model in this position would be
 * confidently wrong in ways nobody could audit.
 */

/**
 * Phrases that mean the author may be talking about their own death now.
 *
 * Chosen to fire on first-person present-tense statements. Deliberately does
 * *not* include bare "suicide" or "overdose" — on this site those are how a
 * parent says how their child died, and firing on them would put a crisis
 * banner in front of half the people describing their loss.
 */
const IMMEDIATE = [
  "kill myself",
  "killing myself",
  "end my life",
  "ending my life",
  "take my own life",
  "taking my own life",
  "want to die",
  "wanna die",
  "want to be dead",
  "better off dead",
  "don't want to be here",
  "dont want to be here",
  "do not want to be here",
  "can't do this anymore",
  "cant do this anymore",
  "can't do this any more",
  "cant do this any more",
  "no reason to live",
  "nothing to live for",
  "not going to be here",
  "won't be here much longer",
  "wont be here much longer",
  "going to join",
  "want to join him",
  "want to join her",
  "want to join them",
  "ready to go now",
  "goodbye everyone",
  "this is my last",
  "end it all",
  "hurt myself",
  "harm myself",
];

/**
 * Phrases suggesting a method or a plan, which is the line between pain and
 * risk — see the "Thoughts of not wanting to be here" chapter, which says the
 * same thing to the reader.
 */
const PLANNING = [
  "wrote a note",
  "written a note",
  "left a note",
  "my pills",
  "the pills",
  "his gun",
  "her gun",
  "my gun",
  "bought a gun",
  "tonight is the night",
  "made up my mind",
  "have a plan",
];

export type CrisisSignal = {
  /** Whether to show the crisis numbers before this is published. */
  matched: boolean;
  /** Whether it also looks like a plan, which a human should see sooner. */
  urgent: boolean;
};

export function checkForCrisis(...parts: (string | null | undefined)[]): CrisisSignal {
  const text = parts
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase()
    // Collapse punctuation so "can't do this... anymore" still matches.
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ");

  const matched = IMMEDIATE.some((phrase) => text.includes(phrase));
  const urgent = matched && PLANNING.some((phrase) => text.includes(phrase));

  return { matched, urgent };
}

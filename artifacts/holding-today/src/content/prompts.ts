import type { Relationship } from "./relationships";

/**
 * The small questions.
 *
 * These exist for one fear, stated plainly by the person who built this site:
 * that the passwords and the tiny quirks and the sound of their laugh are
 * slowly getting fuzzy. A blank journal does not catch those. Nobody sits down
 * to write an essay about what their son ordered at a restaurant — but they
 * will answer that question in fifteen seconds if somebody asks it.
 *
 * Rules for anything added here:
 *
 * 1. **Answerable in under a minute, on a bad day.** If a question needs a
 *    paragraph and a clear head, it belongs in the journal, not here.
 * 2. **Ask for the specific, not the summary.** "What was he like?" gets
 *    nothing. "What did he say wrong for years before anyone corrected him?"
 *    gets the thing that is actually disappearing.
 * 3. **No question that grades the relationship.** Nothing that invites
 *    "did I do enough", nothing about last words or last fights or regrets.
 *    Those are real and they are in the guides; putting them in a rotating
 *    prompt is ambushing somebody with their worst hour over breakfast.
 * 4. **Past tense, and their name where possible.** The app substitutes the
 *    name it has.
 */

export type Prompt = {
  id: string;
  /** `{name}` is replaced with who they lost, or "they" if unknown. */
  question: string;
  /** Shown under the question when it needs a nudge. */
  hint?: string;
  /**
   * Who this makes sense for. Omitted means it works for any loss — most of
   * them do, because a laugh is a laugh.
   */
  relationships?: Relationship[];
};

export const prompts: Prompt[] = [
  // --- the senses, which go first ---
  { id: "laugh", question: "What did {name}'s laugh sound like?", hint: "Was it loud? Silent? Did they wheeze?" },
  { id: "smell", question: "What did {name} smell like?", hint: "A shampoo, a jacket, the back of their neck." },
  { id: "voice", question: "How did {name} answer the phone to you?" },
  { id: "walk", question: "Could you recognise {name} walking, from behind, at a distance?", hint: "What gave them away?" },
  { id: "handwriting", question: "What did {name}'s handwriting look like?" },

  // --- the specific, unrepeatable details ---
  { id: "restaurant-order", question: "What did {name} order, every single time, at the same place?" },
  { id: "said-wrong", question: "What word did {name} say wrong for years?" },
  { id: "catchphrase", question: "What did {name} say constantly that nobody else says?" },
  { id: "drove-crazy", question: "What did {name} do that drove you completely mad?", hint: "You are allowed to miss the annoying parts too." },
  { id: "argument", question: "What did the two of you disagree about, endlessly and pointlessly?" },
  { id: "bad-at", question: "What was {name} genuinely terrible at?" },
  { id: "morning", question: "What was {name} like first thing in the morning?" },
  { id: "clothes", question: "What was {name} wearing, in your head, when you picture them?" },
  { id: "hands", question: "Describe {name}'s hands." },
  { id: "seat", question: "Where did {name} always sit?" },

  // --- what they loved ---
  { id: "song", question: "What song did {name} play until everyone was sick of it?" },
  { id: "film", question: "What did {name} watch over and over?" },
  { id: "food", question: "What did {name} ask you to make?" },
  { id: "hated-food", question: "What would {name} absolutely not eat?" },
  { id: "obsession", question: "What was {name} obsessed with that you never understood?" },
  { id: "good-at", question: "What was {name} quietly very good at?" },

  // --- the ordinary days, which are what actually fades ---
  { id: "ordinary-tuesday", question: "What did an ordinary Tuesday with {name} look like?" },
  { id: "made-you-laugh", question: "What is something {name} did that still makes you laugh?" },
  { id: "proud", question: "What did {name} do that you were proud of and maybe never said?" },
  { id: "kindness", question: "What did {name} do for somebody else that nobody knew about?" },
  { id: "know-them", question: "What would somebody have to know about {name} to actually know them?" },
  { id: "tell-them", question: "What is one thing you would tell a stranger about {name}?" },

  // --- practical, and genuinely urgent ---
  {
    id: "accounts",
    question: "Where are {name}'s accounts, and can you still get into them?",
    hint: "Phone, email, photos, cloud storage. Write down what you know while you still know it.",
  },
  { id: "voicemail", question: "Do you still have {name}'s voice recorded anywhere?", hint: "A voicemail, a video, the background of somebody else's clip." },

  // --- relationship-specific ---
  { id: "child-first-word", question: "What was {name}'s first word?", relationships: ["child"] },
  { id: "child-bedtime", question: "What did bedtime with {name} look like when they were small?", relationships: ["child"] },
  { id: "child-wanted-to-be", question: "What did {name} want to be, at six years old?", relationships: ["child"] },
  { id: "partner-met", question: "Where did you and {name} meet, and what did you think of them?", relationships: ["partner"] },
  { id: "partner-habit", question: "What did {name} do around the house that only they did?", relationships: ["partner"] },
  { id: "partner-sunday", question: "What did a Sunday with {name} look like?", relationships: ["partner"] },
  { id: "parent-taught", question: "What did {name} teach you that you still do their way?", relationships: ["parent"] },
  { id: "parent-saying", question: "What did {name} always say to you, that you now hear in your own voice?", relationships: ["parent"] },
  { id: "parent-kitchen", question: "What did {name}'s kitchen smell like?", relationships: ["parent"] },
  { id: "sibling-secret", question: "What did you and {name} get away with that your parents never found out about?", relationships: ["sibling"] },
  { id: "sibling-shared", question: "What did only {name} know about you?", relationships: ["sibling"] },
  { id: "friend-how-met", question: "How did you and {name} become friends?", relationships: ["friend"] },
  { id: "friend-called", question: "What did you call {name} about, that you cannot call anyone else about?", relationships: ["friend"] },
];

/** Puts the name into a question, falling back to something that still reads. */
export function fillPrompt(question: string, name?: string | null): string {
  const trimmed = name?.trim();
  if (!trimmed) return question.replace(/\{name\}'s/g, "their").replace(/\{name\}/g, "them");
  return question.replace(/\{name\}/g, trimmed);
}

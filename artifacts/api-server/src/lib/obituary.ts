import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import {
  db,
  obituaryDraftsTable,
  type Case,
} from "@workspace/db";

/**
 * Compose an obituary draft from the fields the family filled in.
 *
 * Deliberately a template rather than a language model. Every sentence here is
 * printed, read aloud and kept for forty years, and a fluent invention in the
 * middle of it is a family's permanent record of their mother, wrong. So this
 * joins what it was given in the order obituaries conventionally run, leaves
 * out anything it has no facts for, and invents nothing. (The optional
 * suggested rewrite in `obituary-ai.ts` is a separate, opt-in, director-only
 * step.)
 *
 * What it does do is the grammar a family should not have to think about:
 * "on" a date but "in" a year, "at" a hospice but "in" a town, their chosen
 * pronoun, a capital letter that belongs mid-sentence lowered, and the
 * leading "To" of a thank-you that already begins "The family wishes to
 * thank". A value typed into the wrong box — a place under "Died" — is read
 * as what it is rather than glued in as a date.
 */

export type Pronoun = "she" | "he" | "they";

export type ObituaryFields = {
  fullName: string | null;
  pronouns?: string | null;
  bornOn: string | null;
  birthPlace: string | null;
  diedOn: string | null;
  deathPlace: string | null;
  survivedBy: string | null;
  precededBy: string | null;
  biography: string | null;
  inLieuOfFlowers: string | null;
  specialThanks: string | null;
};

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const SEASONS = "spring|summer|autumn|fall|winter|early|late|mid|christmas|easter";

const clean = (value: string | null | undefined): string =>
  (value ?? "").replace(/\s+/g, " ").trim();

/** Collapse whitespace but keep the paragraph breaks a family typed. */
const cleanProse = (value: string | null | undefined): string =>
  (value ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");

/** Ends a clause with a full stop unless it already ends in punctuation. */
function sentence(text: string): string {
  const trimmed = text.trim().replace(/[,;:]+$/, "");
  if (!trimmed) return "";
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?"”')]$/.test(capital) ? capital : `${capital}.`;
}

/**
 * Whether a value in a date box reads as a date: a year, a month, or a season
 * word. "At home in Denver" does not, and is treated as a place instead.
 */
export function looksLikeDate(value: string): boolean {
  const text = value.toLowerCase();
  if (/\b\d{4}\b/.test(text)) return true;
  if (/\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/.test(text)) return true;
  return new RegExp(`\\b(${MONTHS}|${SEASONS})\\b`).test(text);
}

/** "on 19 March 1941" but "in 1941", "in March 1941", "in the spring of 1931". */
export function datePhrase(value: string): string {
  const text = clean(value).replace(/^(on|in)\s+/i, "");
  if (!text) return "";
  const lower = text.toLowerCase();
  const hasDay =
    /\b\d{1,2}(st|nd|rd|th)?\b/.test(lower.replace(/\b\d{4}\b/g, "")) ||
    /\b\d{1,2}[/.-]\d{1,2}/.test(lower);
  if (hasDay) return `on ${text}`;
  if (new RegExp(`^(${SEASONS})\\b`).test(lower)) return `in the ${lowerFirst(text)}`;
  if (/^the\b/i.test(text)) return `in ${lowerFirst(text)}`;
  return `in ${text}`;
}

const INSTITUTION =
  /\b(home|hospital|hospice|house|center|centre|care|facility|infirmary|clinic|nursing|manor|lodge|residence|church|ward|court|village|medical)\b/i;

/** "in Denver, Colorado", "at Saint Joseph Hospital", "at home in Denver". */
export function placePhrase(value: string): string {
  const text = clean(value).replace(/[.,;]+$/, "");
  if (!text) return "";
  if (/^(at|in|on|near|outside|surrounded|peacefully|while|after|following)\b/i.test(text)) {
    return lowerFirst(text);
  }
  if (/^the\b/i.test(text)) return `at ${lowerFirst(text)}`;
  return INSTITUTION.test(text) ? `at ${text}` : `in ${text}`;
}

/** Common words a family capitalises out of habit at the start of a box. */
const LOWERABLE =
  /^(her|his|their|the|a|an|my|our|donations?|memorial|contributions?|gifts?|husband|wife|partner|son|sons|daughter|daughters|brother|brothers|sister|sisters|mother|father|parents|children|grandchildren|great-grandchildren|nieces?|nephews?|cousins?|friends?|all|many|everyone|staff|nurses?|doctors?|caregivers?|hospice)\b/i;

function lowerFirst(text: string): string {
  const match = text.match(LOWERABLE);
  if (!match) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function pronounOf(fields: ObituaryFields): Pronoun | null {
  const value = clean(fields.pronouns).toLowerCase();
  return value === "she" || value === "he" || value === "they" ? value : null;
}

/** The given name, for when no pronoun was chosen: "Margaret was born…". */
function firstName(fullName: string): string {
  return fullName.split(" ")[0] ?? fullName;
}

export function composeObituary(fields: ObituaryFields): string {
  const name = clean(fields.fullName);
  const pronoun = pronounOf(fields);
  const subject = pronoun
    ? pronoun.charAt(0).toUpperCase() + pronoun.slice(1)
    : name
      ? firstName(name)
      : "They";
  // No name and no pronoun: "Survived by…" rather than a guessed "They".
  const anonymous = !pronoun && !name;
  const plural = pronoun === "they" || anonymous;
  const was = plural ? "were" : "was";
  const is = plural ? "are" : "is";

  let diedOn = clean(fields.diedOn);
  let deathPlace = clean(fields.deathPlace);
  let bornOn = clean(fields.bornOn);
  let birthPlace = clean(fields.birthPlace);

  // A place typed into a date box is a place.
  if (diedOn && !looksLikeDate(diedOn)) {
    deathPlace = deathPlace ? `${diedOn}, ${deathPlace}` : diedOn;
    diedOn = "";
  }
  if (bornOn && !looksLikeDate(bornOn)) {
    birthPlace = birthPlace ? `${bornOn}, ${birthPlace}` : bornOn;
    bornOn = "";
  }
  // "at home in Denver" and "Denver, Colorado": the second repeats the first.
  if (deathPlace.includes(", ")) {
    const [first, ...rest] = deathPlace.split(", ");
    const town = rest.join(", ").split(",")[0]?.trim().toLowerCase() ?? "";
    if (town && first!.toLowerCase().endsWith(town)) {
      deathPlace = first!;
    }
  }

  const paragraphs: string[] = [];

  /* The opening: who, when and where they died, then where they began. */
  const opening: string[] = [];
  const diedKnown = Boolean(diedOn || deathPlace);
  if (name && diedKnown) {
    // "September 3, 2026, at Denver Hospice": a US date takes a comma after
    // the year when more follows.
    const when = diedOn ? datePhrase(diedOn) : "";
    const parts = [
      `${name} died`,
      when && deathPlace && /,\s*\d{4}$/.test(when) ? `${when},` : when,
      deathPlace ? placePhrase(deathPlace) : "",
    ].filter(Boolean);
    opening.push(parts.join(" "));
  }

  if (bornOn || birthPlace) {
    const bornWhen = bornOn ? datePhrase(bornOn) : "";
    const parts = [
      `${name && !diedKnown ? name : subject} ${name && !diedKnown ? "was" : was} born`,
      bornWhen && birthPlace && /,\s*\d{4}$/.test(bornWhen) ? `${bornWhen},` : bornWhen,
      birthPlace ? placePhrase(birthPlace) : "",
    ].filter(Boolean);
    opening.push(parts.join(" "));
  }

  if (opening.length === 0 && name) opening.push(name);
  if (opening.length > 0) paragraphs.push(opening.map(sentence).join(" "));

  /* The life. Kept as the family wrote it — rewriting it would be the one
   * unforgivable edit. Only spacing is tidied. */
  const biography = cleanProse(fields.biography);
  if (biography) paragraphs.push(biography);

  const family: string[] = [];
  const precededBy = stripLead(clean(fields.precededBy), /^(preceded in death by|predeceased by|preceded by)\s+/i);
  if (precededBy) {
    family.push(
      sentence(
        anonymous
          ? `Preceded in death by ${lowerFirst(precededBy)}`
          : `${subject} ${was} preceded in death by ${lowerFirst(precededBy)}`,
      ),
    );
  }
  const survivedBy = stripLead(clean(fields.survivedBy), /^((she|he|they) (is|are) )?survived by\s+/i);
  if (survivedBy) {
    family.push(
      sentence(
        anonymous
          ? `Survived by ${lowerFirst(survivedBy)}`
          : `${subject} ${is} survived by ${lowerFirst(survivedBy)}`,
      ),
    );
  }
  if (family.length > 0) paragraphs.push(family.join(" "));

  const thanks = stripLead(
    clean(fields.specialThanks),
    /^((the family )?(wishes|would like) to thank|(we )?(would like to )?thank(s| you)?( to)?|(our )?(special |heartfelt )?thanks (go )?to|to)\s+/i,
  );
  if (thanks) paragraphs.push(sentence(`The family wishes to thank ${lowerFirst(thanks)}`));

  let flowers = stripLead(clean(fields.inLieuOfFlowers), /^in lieu of flowers,?\s*/i);
  if (flowers) {
    flowers = lowerFirst(flowers).replace(
      /^(memorial donations|memorial contributions|donations|contributions|gifts)\s+(to|in)\b/i,
      "$1 may be made $2",
    );
    paragraphs.push(sentence(`In lieu of flowers, ${flowers}`));
  }

  return paragraphs.join("\n\n");
}

function stripLead(text: string, pattern: RegExp): string {
  return text.replace(pattern, "").trim();
}

/**
 * A gentle note for a date box that holds something else. Shown to the
 * family as they type; never a refusal, because "the spring after the war"
 * is a date too.
 */
export function dateHint(value: string | null | undefined): string | null {
  const text = clean(value);
  if (!text || looksLikeDate(text)) return null;
  return "This looks like a place rather than a date — the box beside it is for where.";
}

/** The gentle notes shown under the date boxes, for both sides. */
export function obituaryHints(fields: Pick<ObituaryFields, "bornOn" | "diedOn">) {
  return { bornOn: dateHint(fields.bornOn), diedOn: dateHint(fields.diedOn) };
}

/* ------------------------------------------------ never ask twice: dates --- */

/**
 * A date the case holds, in the words an obituary uses: "March 4, 1942".
 *
 * Dates of birth and death are calendar days stored as midnight UTC, so they
 * are read in UTC. Read in the home's zone, a Denver home would print every
 * one of them a day early.
 */
export function obituaryDate(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Either the pool or an open transaction. */
type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Fill the obituary's "born" and "died" from what the case already knows.
 *
 * The product's rule is that nobody is asked twice. The director has usually
 * typed both dates by the time the family opens the form, and a daughter
 * being asked for her mother's date of death on a blank line, when the home
 * already has it, is the exact experience this software was bought to end.
 *
 * Only ever into an empty field, and never into an approved obituary. What a
 * family typed -- "spring of 1931", or a date the home had wrong -- is theirs
 * and stays; an approved text has gone to the printer and must not change
 * under it. Called wherever the case's dates can arrive: opening a case,
 * importing one, editing it, and recording a pre-need planner's death.
 */
export async function prefillObituaryDates(
  row: Pick<Case, "id" | "funeralHomeId" | "dateOfBirth" | "dateOfDeath">,
  tx: Db = db,
): Promise<void> {
  const fill = async (key: "bornOn" | "diedOn", value: string | null) => {
    if (!value) return;
    const column = obituaryDraftsTable[key];
    await tx
      .update(obituaryDraftsTable)
      .set({ [key]: value, updatedAt: new Date() })
      .where(
        and(
          eq(obituaryDraftsTable.caseId, row.id),
          eq(obituaryDraftsTable.funeralHomeId, row.funeralHomeId),
          ne(obituaryDraftsTable.status, "approved"),
          or(isNull(column), sql`btrim(${column}) = ''`),
        ),
      );
  };

  await fill("bornOn", obituaryDate(row.dateOfBirth));
  await fill("diedOn", obituaryDate(row.dateOfDeath));
}

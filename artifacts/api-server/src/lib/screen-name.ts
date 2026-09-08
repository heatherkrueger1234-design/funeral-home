import { randomInt } from "node:crypto";

/**
 * Screen names for the shared room.
 *
 * Someone posting about their child at three in the morning should not have to
 * stop and invent a username, and should not accidentally publish under their
 * real one. So a name is assigned when they leave it blank, and it is chosen
 * from a list written for this specific room.
 *
 * The words are deliberately quiet: weather, light, small landscape. Nothing
 * cute, nothing triumphant, nothing about angels or wings or healing — a
 * parent nine days in should not be handed the name "BraveHeart" by a
 * computer. Nothing that reads as a rank either, so no one appears to be more
 * senior in their grief than anyone else.
 */

const FIRST = [
  "Quiet", "Small", "Grey", "Soft", "Distant", "Steady", "Late", "Early",
  "Still", "Pale", "Open", "Low", "Far", "Deep", "Old", "Plain", "Slow",
  "Kind", "Bare", "Long", "Near", "Wide", "Faint", "Clear",
];

const SECOND = [
  "Harbour", "Lantern", "Window", "Meadow", "Kitchen", "Doorway", "River",
  "Orchard", "Hillside", "Thicket", "Shoreline", "Garden", "Landing",
  "Cottage", "Pathway", "Clearing", "Hollow", "Bridge", "Porch", "Field",
  "Chimney", "Anchor", "Willow", "Lighthouse",
];

/**
 * A generated name, e.g. "Quiet Harbour 40".
 *
 * The number is there because the word pairs will collide long before the
 * user base is large — with a couple of hundred people, two "Grey Meadow"s is
 * likely, and two people with the same name in a small support room is worse
 * than an ugly name.
 */
export function generateScreenName(): string {
  const first = FIRST[randomInt(FIRST.length)]!;
  const second = SECOND[randomInt(SECOND.length)]!;
  return `${first} ${second} ${randomInt(10, 100)}`;
}

/** Length bounds, so a name cannot be a paragraph or a single character. */
const MIN = 2;
const MAX = 32;

/**
 * Cleans a name somebody typed. Returns null if what is left is unusable, and
 * the caller then generates one instead.
 *
 * Deliberately strict about what it allows: a screen name is rendered next to
 * other people's writing, and control characters, right-to-left overrides and
 * zero-width joiners are all ways to make one post impersonate another.
 */
export function normaliseScreenName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;

  const cleaned = raw
    // Strip anything that is not a letter, number, space, hyphen or apostrophe.
    // This drops control characters and bidi overrides along with the emoji.
    .replace(/[^\p{L}\p{N} '\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < MIN || cleaned.length > MAX) return null;
  return cleaned;
}

/**
 * Names nobody may take, because taking one is a way to speak with borrowed
 * authority in a room full of people who are not thinking clearly.
 */
const RESERVED = [
  "admin", "administrator", "moderator", "mod", "staff", "support",
  "holding today", "holdingtoday", "official", "team", "system", "help",
  "counsellor", "counselor", "therapist", "doctor", "988", "crisis line",
];

export function isReservedScreenName(name: string): boolean {
  const lowered = name.toLowerCase().replace(/[\s'-]/g, "");
  return RESERVED.some((word) => lowered === word.replace(/[\s'-]/g, ""));
}

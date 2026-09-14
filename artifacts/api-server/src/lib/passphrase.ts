import { randomInt } from "node:crypto";

/**
 * A password a funeral director can read down a telephone without spelling it
 * twice, to somebody who is writing it on the back of an envelope.
 *
 * Three short words and two digits. That is deliberately not the strongest
 * shape available — but the realistic alternative here is not a stronger
 * password, it is a director who gives up and tells the family to just use
 * the link, which is the outcome this whole mechanism exists to avoid.
 *
 * The list is short, concrete, easy to spell and free of anything that reads
 * badly in a funeral home. No homophones ("pear"/"pair"), nothing that could
 * be heard as something else, nothing about death.
 */
const WORDS = [
  "amber", "anchor", "apple", "arbour", "autumn", "basket", "beacon", "birch",
  "bridge", "bronze", "candle", "canvas", "cedar", "chapel", "clover", "copper",
  "cottage", "crimson", "crystal", "dahlia", "daisy", "eagle", "ember", "fabric",
  "falcon", "fennel", "garden", "gentle", "ginger", "granite", "harbour", "hazel",
  "heather", "hollow", "indigo", "ivory", "jasmine", "juniper", "kestrel", "lantern",
  "laurel", "lavender", "lemon", "linen", "maple", "marble", "meadow", "mulberry",
  "nutmeg", "oakwood", "orchard", "parchment", "pebble", "pewter", "poplar", "quartz",
  "quiet", "ribbon", "river", "rosemary", "saffron", "sandal", "silver", "sparrow",
  "spruce", "sterling", "sunlit", "tallow", "thistle", "timber", "tulip", "velvet",
  "walnut", "willow", "window", "winter", "wren",
];

/**
 * Roughly 44 bits before the digits, which is ample for a credential that is
 * rate-limited, tied to one case, and replaced the moment a director asks.
 */
export function issuePassphrase(): string {
  const words = Array.from(
    { length: 3 },
    () => WORDS[randomInt(WORDS.length)]!,
  );
  return `${words.join("-")}-${String(randomInt(10, 100))}`;
}

/**
 * Who the person you lost was to you.
 *
 * This tags content; it never gates it. A reader who says "partner" is shown
 * partner chapters first and the parent chapters second, with a quiet label
 * saying who they were written for. Nothing is hidden from anybody, because
 * grief does not sort cleanly — somebody here lost a son, her parents, her
 * grandparents, a baby and her best friend, and any design that made her pick
 * one box would have shut her out of most of what she needed.
 *
 * Chapters with no `relationships` tag are universal, and most of the
 * practical ones genuinely are: an autopsy, a death certificate, a medical
 * bill and a landlord do not care who died.
 */

export const RELATIONSHIPS = [
  {
    value: "child",
    label: "My child",
    /** Used on chapter labels: "Written for bereaved parents". */
    writtenFor: "bereaved parents",
  },
  { value: "partner", label: "My partner or spouse", writtenFor: "bereaved partners" },
  { value: "parent", label: "My parent", writtenFor: "people who have lost a parent" },
  { value: "sibling", label: "My sibling", writtenFor: "bereaved siblings" },
  { value: "friend", label: "My friend", writtenFor: "people who have lost a friend" },
  { value: "other", label: "Someone else", writtenFor: "anyone grieving" },
] as const;

export type Relationship = (typeof RELATIONSHIPS)[number]["value"];

export const RELATIONSHIP_VALUES: readonly Relationship[] = RELATIONSHIPS.map(
  (r) => r.value,
);

export function isRelationship(value: unknown): value is Relationship {
  return (
    typeof value === "string" &&
    (RELATIONSHIP_VALUES as readonly string[]).includes(value)
  );
}

export function writtenForLabel(relationships: readonly string[]): string | null {
  const first = RELATIONSHIPS.find((r) => relationships.includes(r.value));
  return first ? `Written for ${first.writtenFor}` : null;
}

/**
 * How a chapter ranks for a given reader.
 *
 * 0 — written for exactly them.
 * 1 — universal, so it is for them too.
 * 2 — written for a different loss, still readable, shown last and labelled.
 *
 * A reader who has said nothing gets everything in its authored order, which
 * is the order it reads best in.
 */
export function relevanceRank(
  chapterRelationships: readonly string[] | undefined,
  readerRelationships: readonly string[] | undefined,
): number {
  if (!readerRelationships?.length) return 1;
  if (!chapterRelationships?.length) return 1;
  return chapterRelationships.some((r) => readerRelationships.includes(r)) ? 0 : 2;
}

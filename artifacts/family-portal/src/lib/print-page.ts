/*
 * Reading a rendered proof's printed size, so the portal can draw the whole
 * card at phone width. Kept apart from the hook that fetches the proof so it
 * can be tested without a network.
 */

/** The `@page` width in CSS pixels, or null if the template does not say. */
export function pageWidthOf(html: string): number | null {
  const match = /@page\s*\{[^}]*?size:\s*([\d.]+)\s*(in|mm|cm|px)/i.exec(html);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const perUnit = { in: 96, mm: 96 / 25.4, cm: 96 / 2.54, px: 1 } as const;
  return value * perUnit[match[2]!.toLowerCase() as keyof typeof perUnit];
}

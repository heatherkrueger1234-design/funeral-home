import { useEffect } from "react";

/*
 * The funeral home's own colour, painted over the theme's default. Shared by
 * the portal's shell and the home's public front door, which sits outside
 * the shell but is the same home.
 */

/**
 * Paint the funeral home's colour over the theme's default.
 *
 * `statusBar` is for a screen with the branded header along its top; the
 * front door has none, and a deep green strip over a cream page would be a
 * header that is not there.
 */
export function useBrandColor(
  accent: string | undefined,
  { statusBar = true }: { statusBar?: boolean } = {},
) {
  useEffect(() => {
    if (!accent) return;

    const root = document.documentElement;
    root.style.setProperty("--accent", accent);
    // A soft wash and a deeper shade, derived so a home only has to give one
    // colour. Mixed in oklab so a mid-tone brand colour does not produce a
    // muddy tint the way naive RGB blending does.
    root.style.setProperty("--accent-soft", `color-mix(in oklab, ${accent} 10%, white)`);
    root.style.setProperty("--accent-deep", `color-mix(in oklab, ${accent} 80%, black)`);

    /*
     * The phone's own furniture, painted to match.
     *
     * This is opened on a phone, nearly always, and the branded header runs
     * right up under the status bar. Without this the strip above it stays
     * white and the page reads as a website that has been coloured in rather
     * than as something the funeral home handed over. It is a small detail
     * and it is most of the difference between the two.
     *
     * The header is a gradient from `--accent-deep` at the top down to
     * `--accent`, and it is the top that meets the status bar — so it is
     * that darker shade to match. Two things stop us simply reading the
     * token. A custom property is handed back verbatim by
     * `getComputedStyle`, so what comes out is the `color-mix()` expression
     * rather than a colour; and mixing in oklab, which is right for the page,
     * computes to an `oklab()` string that a `theme-color` meta tag cannot be
     * relied on to parse — least of all on the iOS Safari that most of these
     * families are holding.
     *
     * Asking the browser to compute the mix does not help either: Chrome
     * hands an sRGB mix back as `color(srgb 0.09 0.24 0.21)`, which is the
     * same problem in a different notation.
     *
     * So the browser is asked only for the one thing it answers in plain
     * `rgb(...)` — the home's own colour, normalised out of whatever
     * notation it was stored in — and the darkening is done here, where it
     * is three multiplications and cannot be serialised into a surprise.
     */
    if (!statusBar) return;
    const meta =
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]') ??
      document.head.appendChild(
        Object.assign(document.createElement("meta"), { name: "theme-color" }),
      );
    meta.content = darken(accent, 0.8) ?? accent;
  }, [accent, statusBar]);
}

/**
 * A CSS colour, mixed `amount` of the way from black, as `rgb(r, g, b)`.
 *
 * Returns null if this browser could not make sense of the colour at all, in
 * which case the caller uses the home's colour undarkened — a shade light
 * rather than wrong.
 *
 * The browser does the parsing, because a funeral home's accent is stored as
 * free text and may arrive as a hex triple, a six-digit hex, `rgb()` or a
 * colour name, and re-implementing that here would be a parser to get wrong.
 * Computed `color` normalises all of them to `rgb(r, g, b)`.
 */
function darken(color: string, amount: number): string | null {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;color:${color}`;

  // The browser rejected the value outright, so there is nothing to read.
  if (!probe.style.color) return null;

  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();

  const channels = /^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(computed);
  if (!channels) return null;

  const [r, g, b] = channels
    .slice(1, 4)
    .map((channel) => Math.round(Number(channel) * amount));

  return `rgb(${r}, ${g}, ${b})`;
}


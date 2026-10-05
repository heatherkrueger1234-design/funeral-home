/**
 * The looks a card or programme can take.
 *
 * A theme is type, colour, a photograph shape and an ornament — never
 * layout. The template still decides where everything sits, so a theme
 * cannot push a name into the fold. Fonts are system stacks: the rendered
 * page carries a strict CSP (no web fonts), and every stack below ends in
 * something every Mac and Windows machine has.
 */

export type PhotoShape = "rect" | "arch" | "oval" | "circle";

export type PrintTheme = {
  key: string;
  name: string;
  description: string;
  headingFont: string;
  bodyFont: string;
  /** Uppercase, letter-spaced headings. */
  smallCaps: boolean;
  ink: string;
  muted: string;
  paper: string;
  /** The theme's own accent; null follows the home's brand colour. */
  accent: string | null;
  photoShape: PhotoShape;
  /** A short divider drawn under the dates, as inline SVG using currentColor. */
  ornament: string | null;
  /** A frame drawn inside the trim line. */
  frame: "none" | "hairline" | "double" | "corners";
};

const SERIF_CLASSIC = 'Georgia, "Times New Roman", serif';
const SERIF_BOOK = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
const SERIF_GARAMOND = 'Garamond, "EB Garamond", "Adobe Garamond Pro", Georgia, serif';
const SERIF_DIDONE = 'Didot, "Bodoni 72", "Bodoni MT", "Times New Roman", serif';
const SANS_HUMANIST = 'Optima, Candara, "Segoe UI", "Gill Sans", sans-serif';
const SANS_GEOMETRIC = '"Avenir Next", Avenir, "Century Gothic", "Segoe UI", Helvetica, sans-serif';

const svg = (inner: string, width = 120, height = 14) =>
  `<svg class="ornament" viewBox="0 0 ${width} ${height}" width="${width / 100}in" height="${height / 100}in" aria-hidden="true">${inner}</svg>`;

const ORNAMENTS = {
  rule: svg(
    `<line x1="10" y1="7" x2="52" y2="7" stroke="currentColor" stroke-width=".8"/>` +
      `<circle cx="60" cy="7" r="2.2" fill="currentColor"/>` +
      `<line x1="68" y1="7" x2="110" y2="7" stroke="currentColor" stroke-width=".8"/>`,
  ),
  sprig: svg(
    `<path d="M20 9 C45 9 55 5 60 3 C65 5 75 9 100 9" fill="none" stroke="currentColor" stroke-width=".8"/>` +
      `<ellipse cx="45" cy="6" rx="5" ry="2" transform="rotate(-20 45 6)" fill="currentColor" opacity=".7"/>` +
      `<ellipse cx="75" cy="6" rx="5" ry="2" transform="rotate(20 75 6)" fill="currentColor" opacity=".7"/>` +
      `<ellipse cx="33" cy="8" rx="4" ry="1.6" transform="rotate(-10 33 8)" fill="currentColor" opacity=".5"/>` +
      `<ellipse cx="87" cy="8" rx="4" ry="1.6" transform="rotate(10 87 8)" fill="currentColor" opacity=".5"/>`,
  ),
  wave: svg(
    `<path d="M10 7 Q20 2 30 7 T50 7 T70 7 T90 7 T110 7" fill="none" stroke="currentColor" stroke-width=".9"/>`,
  ),
  diamond: svg(
    `<line x1="18" y1="7" x2="54" y2="7" stroke="currentColor" stroke-width=".6"/>` +
      `<path d="M60 2 L65 7 L60 12 L55 7 Z" fill="none" stroke="currentColor" stroke-width=".8"/>` +
      `<line x1="66" y1="7" x2="102" y2="7" stroke="currentColor" stroke-width=".6"/>`,
  ),
  cross: svg(
    `<line x1="20" y1="7" x2="52" y2="7" stroke="currentColor" stroke-width=".6"/>` +
      `<path d="M60 1 V13 M56 5 H64" stroke="currentColor" stroke-width="1.1" fill="none"/>` +
      `<line x1="68" y1="7" x2="100" y2="7" stroke="currentColor" stroke-width=".6"/>`,
  ),
  star: svg(
    `<line x1="20" y1="7" x2="50" y2="7" stroke="currentColor" stroke-width=".6"/>` +
      `<path d="M60 1.5 L61.6 5.4 L65.8 5.6 L62.5 8.2 L63.6 12.3 L60 10 L56.4 12.3 L57.5 8.2 L54.2 5.6 L58.4 5.4 Z" fill="currentColor"/>` +
      `<line x1="70" y1="7" x2="100" y2="7" stroke="currentColor" stroke-width=".6"/>`,
  ),
};

export const PRINT_THEMES: readonly PrintTheme[] = [
  {
    key: "classic",
    name: "Classic",
    description: "Georgia on white with a quiet rule. Right for almost anyone.",
    headingFont: SERIF_CLASSIC,
    bodyFont: SERIF_CLASSIC,
    smallCaps: false,
    ink: "#1a1a1a",
    muted: "#5b5b5b",
    paper: "#ffffff",
    accent: null,
    photoShape: "rect",
    ornament: ORNAMENTS.rule,
    frame: "none",
  },
  {
    key: "heritage",
    name: "Heritage",
    description: "Cream stock, a double border and small capitals. Traditional and formal.",
    headingFont: SERIF_GARAMOND,
    bodyFont: SERIF_GARAMOND,
    smallCaps: true,
    ink: "#2b2118",
    muted: "#6b5a48",
    paper: "#fbf6ec",
    accent: "#7a5b2e",
    photoShape: "oval",
    ornament: ORNAMENTS.diamond,
    frame: "double",
  },
  {
    key: "garden",
    name: "Garden",
    description: "A leafy sprig, sage green and an arched portrait. For a gardener, or spring.",
    headingFont: SERIF_BOOK,
    bodyFont: SERIF_BOOK,
    smallCaps: false,
    ink: "#23302a",
    muted: "#5d6b62",
    paper: "#fbfcf8",
    accent: "#4f7a5a",
    photoShape: "arch",
    ornament: ORNAMENTS.sprig,
    frame: "hairline",
  },
  {
    key: "modern",
    name: "Modern",
    description: "Clean sans-serif, generous space and a circular portrait.",
    headingFont: SANS_GEOMETRIC,
    bodyFont: SANS_GEOMETRIC,
    smallCaps: true,
    ink: "#161616",
    muted: "#6a6a6a",
    paper: "#ffffff",
    accent: null,
    photoShape: "circle",
    ornament: null,
    frame: "none",
  },
  {
    key: "coastal",
    name: "Coastal",
    description: "Sea blue with a wave divider. For someone who loved the water.",
    headingFont: SANS_HUMANIST,
    bodyFont: SANS_HUMANIST,
    smallCaps: false,
    ink: "#14263a",
    muted: "#4f6478",
    paper: "#f7fafc",
    accent: "#2e6a8e",
    photoShape: "rect",
    ornament: ORNAMENTS.wave,
    frame: "hairline",
  },
  {
    key: "sanctuary",
    name: "Sanctuary",
    description: "A small cross, an arched portrait and deep burgundy. For a service of faith.",
    headingFont: SERIF_GARAMOND,
    bodyFont: SERIF_GARAMOND,
    smallCaps: true,
    ink: "#221a1c",
    muted: "#63545a",
    paper: "#fffdfa",
    accent: "#6d2a36",
    photoShape: "arch",
    ornament: ORNAMENTS.cross,
    frame: "corners",
  },
  {
    key: "evening",
    name: "Evening",
    description: "A fine Didone face with a star, in navy and gold. Elegant and a little grand.",
    headingFont: SERIF_DIDONE,
    bodyFont: SERIF_CLASSIC,
    smallCaps: true,
    ink: "#131a2b",
    muted: "#55607a",
    paper: "#fdfcf9",
    accent: "#a7802f",
    photoShape: "oval",
    ornament: ORNAMENTS.star,
    frame: "double",
  },
];

export const DEFAULT_THEME_KEY = "classic";

export function findTheme(key: string | null | undefined): PrintTheme {
  return PRINT_THEMES.find((theme) => theme.key === key) ?? PRINT_THEMES[0]!;
}

export function isThemeKey(key: string): boolean {
  return PRINT_THEMES.some((theme) => theme.key === key);
}

/** The theme's CSS, layered over the base sheet in `print-render.ts`. */
export function themeCss(theme: PrintTheme): string {
  const shape: Record<PhotoShape, string> = {
    rect: "border-radius: 2pt;",
    arch: "border-radius: 999px 999px 3pt 3pt;",
    oval: "border-radius: 50%;",
    circle: "border-radius: 50%; aspect-ratio: 1 / 1; width: 78%;",
  };
  const frame: Record<PrintTheme["frame"], string> = {
    none: "",
    hairline: `.panel::after { content: ""; position: absolute; inset: calc(var(--bleed) + .09in); border: .6pt solid var(--accent); opacity: .45; pointer-events: none; }`,
    double: `.panel::after { content: ""; position: absolute; inset: calc(var(--bleed) + .08in); border: 2.4pt double var(--accent); opacity: .6; pointer-events: none; }`,
    corners: `.panel::after { content: ""; position: absolute; inset: calc(var(--bleed) + .09in); pointer-events: none; opacity: .6;
      background:
        linear-gradient(var(--accent),var(--accent)) top left/.35in .8pt no-repeat,
        linear-gradient(var(--accent),var(--accent)) top left/.8pt .35in no-repeat,
        linear-gradient(var(--accent),var(--accent)) top right/.35in .8pt no-repeat,
        linear-gradient(var(--accent),var(--accent)) top right/.8pt .35in no-repeat,
        linear-gradient(var(--accent),var(--accent)) bottom left/.35in .8pt no-repeat,
        linear-gradient(var(--accent),var(--accent)) bottom left/.8pt .35in no-repeat,
        linear-gradient(var(--accent),var(--accent)) bottom right/.35in .8pt no-repeat,
        linear-gradient(var(--accent),var(--accent)) bottom right/.8pt .35in no-repeat; }`,
  };

  return `
  body { font-family: ${theme.bodyFont}; color: ${theme.ink}; }
  .panel { background: ${theme.paper}; }
  h1 { font-family: ${theme.headingFont}; ${theme.smallCaps ? "font-variant: small-caps; letter-spacing: .04em; font-weight: 500;" : ""} }
  h2 { font-family: ${theme.headingFont}; }
  .dates, .footer, .mark--text { color: ${theme.muted}; }
  .photo { ${shape[theme.photoShape]} }
  .ornament { display: block; margin: .02in auto .06in; color: var(--accent); }
  ${frame[theme.frame]}
  `;
}

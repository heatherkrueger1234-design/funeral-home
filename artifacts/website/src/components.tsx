import type { ReactNode } from "react";
import { src, srcSet, type Screen } from "./screens";

/*
 * Icons are inlined rather than pulled from an icon package: there are five
 * of them, and the page ships no script, so a component library would only
 * add build weight. Paths are Lucide's (ISC), drawn at 24px, 1.75 stroke,
 * the same set the apps use.
 */
const paths: Record<string, ReactNode> = {
  lock: (
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  minus: <path d="M5 12h14" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),
};

export function Icon(props: { name: keyof typeof paths; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={props.className ?? "size-5"}
    >
      {paths[props.name]}
    </svg>
  );
}

type Loading = { eager?: boolean; sizes: string };

function Picture(props: { screen: Screen; className?: string } & Loading) {
  const { screen } = props;
  return (
    <img
      src={src(screen)}
      srcSet={srcSet(screen)}
      sizes={props.sizes}
      width={screen.width}
      height={screen.height}
      alt={screen.alt}
      loading={props.eager ? "eager" : "lazy"}
      decoding={props.eager ? "sync" : "async"}
      // React 19 passes fetchPriority through as the fetchpriority attribute.
      fetchPriority={props.eager ? "high" : undefined}
      className={props.className}
    />
  );
}

/**
 * A desktop screenshot, set in a plain window frame. The frame has no address
 * bar: a made-up URL in a screenshot is a small lie, and a real one would be
 * an invitation to type it.
 */
export function Desk(props: { screen: Screen; className?: string } & Loading) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-border-strong bg-card shadow-float ${props.className ?? ""}`}
    >
      <div className="flex h-7 items-center gap-1.5 border-b border-border bg-sunken px-3" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="size-2.5 rounded-full bg-border-strong" />
      </div>
      <Picture screen={props.screen} sizes={props.sizes} eager={props.eager} className="block w-full" />
    </div>
  );
}

/** A phone screenshot in a simple bezel. */
export function Phone(props: { screen: Screen; className?: string } & Loading) {
  return (
    <div
      className={`rounded-[2.6rem] bg-[#1b201d] p-[0.55rem] shadow-float ring-1 ring-black/5 ${props.className ?? ""}`}
    >
      <Picture
        screen={props.screen}
        sizes={props.sizes}
        eager={props.eager}
        className="block w-full rounded-[2.1rem]"
      />
    </div>
  );
}

export function Section(props: {
  id?: string;
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={props.id} aria-labelledby={props.labelledBy} className={props.className}>
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">{props.children}</div>
    </section>
  );
}

export const buttonPrimary =
  "inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-base font-semibold text-white no-underline shadow-raised transition-colors duration-200 hover:bg-accent-deep";

export const buttonSecondary =
  "inline-flex items-center justify-center gap-2 rounded-full border border-border-strong bg-card px-6 py-3 text-base font-semibold text-foreground no-underline transition-colors duration-200 hover:border-accent hover:text-accent-deep";

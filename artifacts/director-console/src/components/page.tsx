import type { ComponentType, ReactNode } from "react";

/**
 * The parts every screen in the console is built from.
 *
 * Before this existed each screen and each case panel rolled its own: a
 * heading at whatever size, a spinner in a box of whatever height, and a
 * dashed grey rectangle for "nothing here". Sixteen separate spinners, no
 * two of them in quite the same place. There is now one of each, and a
 * screen that is waiting looks like the screen that is coming.
 */

export function PageHeader({
  title,
  children,
  aside,
}: {
  title: string;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-2xl leading-tight">{title}</h1>
        {children && (
          <p className="mt-1 max-w-prose text-muted-foreground">{children}</p>
        )}
      </div>
      {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
    </header>
  );
}

/**
 * Waiting, as the shape of what is coming.
 *
 * A director opens this console forty times a day, so the half-second before
 * data lands is a half-second they see forty times. A skeleton the size of
 * the real rows means the page does not jolt when it arrives.
 */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="shimmer h-16 rounded-xl border border-border bg-[var(--muted)]/50"
        />
      ))}
    </div>
  );
}

/** A single short bar, for a panel that holds a paragraph rather than a list. */
export function LoadingLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2.5" role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className="shimmer h-4 rounded bg-[var(--muted)]"
          style={{ width: `${100 - index * 12}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Nothing here yet — which is usually the ordinary state of a new case, not
 * a fault. A calm recessed panel, never the dashed rectangle that means
 * "broken" everywhere else on the web.
 */
export function Empty({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-[var(--sunken)] px-6 py-10 text-center">
      {Icon && (
        <span className="mx-auto mb-3.5 grid size-11 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-deep)]">
          <Icon className="size-5" strokeWidth={1.5} />
        </span>
      )}
      <p className="font-display text-base">{title}</p>
      {children && (
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {children}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** A hairline with a name on it. */
export function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="eyebrow">{label}</h2>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

/** The console's one card. */
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)] ${className}`}
    >
      {children}
    </section>
  );
}

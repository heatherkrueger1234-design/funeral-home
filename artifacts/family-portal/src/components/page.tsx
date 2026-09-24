import type { ComponentType, ReactNode } from "react";
import { RotateCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The parts every screen in the portal is built from.
 *
 * Before this existed each page set its own heading size, wrote its own
 * spinner and drew its own dashed box for "nothing here yet". They were all
 * slightly different — 2xl here, xl there, a spinner with twelve pixels of
 * padding on one screen and forty-eight on the next — and the cumulative
 * effect was a product that felt assembled rather than designed. There is now
 * one of each.
 */

/**
 * A page's title, and the sentence under it that says what the page is for.
 *
 * The sentence is not optional and not decoration: this portal is read by
 * people who did not choose to be here and were not trained on it, and a
 * bare heading leaves them to guess.
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
        <h1 className="font-display text-[1.875rem] leading-[1.15]">{title}</h1>
        {children && (
          <p className="mt-2 max-w-prose text-muted-foreground">{children}</p>
        )}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </header>
  );
}

/**
 * Waiting, drawn as the shape of what is coming rather than as a spinner.
 *
 * A spinner says "something is happening to you". A skeleton says "this is
 * what will be here", and — the practical half — the page does not jump when
 * the data lands, because the space was already the right size.
 */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-20 rounded-xl border border-border bg-[var(--muted)]/50"
        />
      ))}
    </div>
  );
}

/**
 * Nothing here yet — which on this product is usually good news, not an
 * error. So: a calm card in the home's own colour rather than the dashed
 * grey rectangle that means "broken" everywhere else on the web.
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
    <div className="rounded-xl border border-border bg-[var(--sunken)] px-6 py-12 text-center">
      {Icon && (
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-deep)]">
          <Icon className="size-6" strokeWidth={1.5} />
        </span>
      )}
      <p className="font-display text-lg">{title}</p>
      {children && (
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {children}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * A hairline with a name on it. The same section marker the hub uses, so a
 * heading means the same thing on every screen.
 */
export function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="eyebrow">{label}</h2>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

/**
 * A white card. Most screens are one or two of these; having it here is what
 * stops the third one being 1rem of padding instead of 1.25.
 */
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

/**
 * A screen whose information did not arrive.
 *
 * Before this, a page that failed to load drew itself as though it were
 * empty — "Nothing to check at the moment", "Nothing is waiting on you" —
 * which is worse than an error: it is a calm, confident, wrong answer. The
 * toast that said otherwise was gone in five seconds. This says plainly that
 * the page did not load, that nothing is lost, and offers the one action.
 */
export function LoadFailed({
  title,
  onRetry,
}: {
  title: string;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} />
      <Empty
        icon={WifiOff}
        title="This page didn't load"
        action={
          <Button type="button" variant="outline" onClick={onRetry}>
            <RotateCw className="size-4" />
            Try again
          </Button>
        }
      >
        Nothing you have added is lost. It is usually the connection — please
        try again in a moment.
      </Empty>
    </div>
  );
}

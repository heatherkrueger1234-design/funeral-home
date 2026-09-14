import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";
import { cn } from "@/lib/api";

/**
 * The console's small vocabulary of parts.
 *
 * Deliberately small, and deliberately not a component library. There are
 * four kinds of button here, one card, one input and three ways of saying
 * "there is nothing to show", and every screen is built from those. A
 * well-funded year produces one way to do each thing, not three.
 */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet" | "plain" | "destructive";
};

export function Button({
  variant = "quiet",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        // 44px minimum: half of everything here is eventually done on a
        // laptop trackpad in a hotel lobby.
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4",
        "text-sm font-semibold transition-colors duration-150 ease-out",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "bg-[var(--accent)] text-white hover:bg-[var(--accent-deep)]",
        variant === "quiet" &&
          "border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)]",
        variant === "plain" &&
          "px-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
        variant === "destructive" &&
          "border border-[var(--destructive)] text-[var(--destructive)] hover:bg-[var(--destructive)] hover:text-white",
        className,
      )}
    />
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-[var(--border)] bg-[var(--card)] p-6",
        "shadow-[0_1px_2px_rgba(31,36,33,0.04)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="font-display text-lg">{children}</h2>
      {action}
    </header>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  /** What is wrong, in words. Never "Invalid input". */
  problem?: string;
};

/**
 * A labelled input. There is no unlabelled one, and no placeholder standing
 * in for a label — a placeholder disappears the moment somebody types, which
 * is exactly when they are most likely to have forgotten what the box was.
 */
export function Field({ label, hint, problem, className, ...props }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        {...props}
        id={id}
        aria-describedby={hint || problem ? hintId : undefined}
        aria-invalid={problem ? true : undefined}
        className={cn(
          "min-h-11 rounded-md border border-[var(--border)] bg-white px-3",
          "text-base placeholder:text-[var(--muted-foreground)]",
          problem && "border-[var(--notice)]",
          className,
        )}
      />
      {(hint || problem) && (
        <p
          id={hintId}
          className={cn(
            "text-sm",
            problem ? "text-[var(--notice)]" : "text-[var(--muted-foreground)]",
          )}
        >
          {problem ?? hint}
        </p>
      )}
    </div>
  );
}

export function Select({
  label,
  children,
  ...props
}: InputHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <select
        {...(props as object)}
        id={id}
        className="min-h-11 rounded-md border border-[var(--border)] bg-white px-3 text-base"
      >
        {children}
      </select>
    </div>
  );
}

/**
 * Loading, as the shape of the thing that is coming.
 *
 * Never a spinner in the middle of an empty page: a skeleton that matches the
 * real layout means the page does not jump when the data lands, and it tells
 * you what you are waiting for.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-md bg-[var(--muted)]",
        className,
      )}
    />
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}

/**
 * Nothing here yet — and never a dead end. Every empty state says what this
 * is for and offers the one action that fills it.
 */
export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md bg-[var(--muted)] p-6">
      <h3 className="font-display text-base">{title}</h3>
      <p className="max-w-prose text-sm text-[var(--muted-foreground)]">
        {detail}
      </p>
      {action}
    </div>
  );
}

/** Something went wrong, and what to do about it. */
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "Please check your connection.";

  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-[var(--notice)] bg-[var(--notice-soft)] p-6">
      <h3 className="font-display text-base">That didn't load</h3>
      <p className="max-w-prose text-sm">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="quiet">
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * A home's own brand colour, at the size of a full stop.
 *
 * The only place a customer's colour appears in this console — enough to
 * recognise a home by in a list of forty, and not enough to make the platform
 * look like it belongs to them.
 */
export function Swatch({ color, name }: { color: string; name: string }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full ring-1 ring-black/10"
      style={{ background: color }}
      // The colour is decoration; the name beside it is the information.
      aria-hidden
      title={name}
    />
  );
}

/**
 * A number and what it counts.
 *
 * No trend arrows, no percentage change, no sparkline. This is a product
 * about dignity, not a dashboard about growth, and a green arrow next to
 * "cases opened" is a green arrow next to how many people died.
 */
export function Stat({
  label,
  value,
  of,
}: {
  label: string;
  value: number;
  /** Renders as "12 of 30" where a bare count would mislead. */
  of?: number;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="tabular text-2xl">
        {value.toLocaleString("en-US")}
        {of !== undefined && (
          <span className="text-base text-[var(--muted-foreground)]">
            {" "}
            of {of.toLocaleString("en-US")}
          </span>
        )}
      </span>
      <span className="text-sm text-[var(--muted-foreground)]">{label}</span>
    </div>
  );
}

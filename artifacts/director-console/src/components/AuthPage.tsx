import type { ReactNode } from "react";

/**
 * The layout the signed-out screens share.
 *
 * Lifted out of `SignIn` when the token-landing pages arrived, so that a
 * director who clicks a link in an email sees the same page they signed in on
 * rather than something that looks like a different company. The name in the
 * serif above the card, the work inside it.
 */
export function AuthPage(props: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-7 text-center">
          <h1 className="font-display text-[1.75rem] leading-tight">
            Holding Today
          </h1>
        </header>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--elevation-2)] sm:p-7">
          <h2 className="font-display text-xl leading-tight">{props.title}</h2>
          {props.intro && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {props.intro}
            </p>
          )}
          <div className="mt-5">{props.children}</div>
        </div>
      </div>
    </div>
  );
}

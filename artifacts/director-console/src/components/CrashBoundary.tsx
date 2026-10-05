import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { reportCrash } from "@/lib/crash-report";
import { BASE_PATH } from "@/lib/base";

/**
 * A screen that throws while drawing, caught before it takes the whole
 * console with it.
 *
 * React unmounts everything above an uncaught render error, so before this a
 * single bad record on one case page left a director looking at a blank
 * white window -- no navigation, no way back, and nobody here told. Two of
 * these are mounted: one around the page area, keyed on the address so
 * moving to another screen clears it and the bar across the top survives,
 * and one around the whole app in `main.tsx` as the last resort.
 *
 * Plain words and no red. The report has already been sent, and nothing the
 * director saved is lost, so the screen says both and offers the way back.
 */
export class CrashBoundary extends Component<
  { children: ReactNode; whole?: boolean },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportCrash("console", "render", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    const panel = (
      <section className="mx-auto max-w-md space-y-4 rounded-xl border border-border bg-card p-6 shadow-[var(--elevation-1)]">
        <h1 className="font-display text-xl">
          This screen didn't open properly
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          We've been told about it. Nothing you saved has been lost — reload to
          carry on, or go back to today's page.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button
            variant="outline"
            onClick={() => window.location.assign(`${BASE_PATH}/`)}
          >
            Back to today
          </Button>
        </div>
      </section>
    );

    return this.props.whole ? (
      <main className="grid min-h-dvh place-items-center px-6 py-12">
        {panel}
      </main>
    ) : (
      <div className="py-12">{panel}</div>
    );
  }
}

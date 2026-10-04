import { Component, type ReactNode } from "react";
import { Button, Card } from "@/components/ui";
import { reportCrash } from "@/lib/crash-report";
import { BASE_PATH } from "@/lib/base";

/**
 * A screen that throws while drawing, caught before it blanks the console.
 *
 * The same arrangement as the director console's: one boundary around the
 * page area, keyed on the address so moving to another screen clears it,
 * and one around the whole app in `main.tsx`. The report has gone to the
 * error log by the time this is drawn.
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
    reportCrash("admin", "render", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    const panel = (
      <Card className="mx-auto w-full max-w-md">
        <h1 className="font-display text-xl">
          This screen didn't open properly
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
          It has been reported. Nothing you saved has been lost.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload
          </Button>
          <Button
            variant="plain"
            onClick={() => window.location.assign(`${BASE_PATH}/`)}
          >
            Back to the overview
          </Button>
        </div>
      </Card>
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

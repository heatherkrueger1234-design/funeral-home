import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { reportCrash } from "@/lib/crash-report";

/**
 * The page a family sees if a screen throws while drawing.
 *
 * Without it, React unmounts the whole portal and a daughter who opened the
 * link from the funeral home is left with a blank white page, no name, no
 * telephone number and no idea whether what she uploaded last night is still
 * there. She is also the person least likely to tell anybody: she has no
 * account to complain from. So the failure is reported from here, and the
 * page says the three things she needs -- nothing is lost, how to try again,
 * and who to call -- in the portal's own voice. No red, no apology theatre.
 *
 * Mounted around the whole app, in `main.tsx`, so it has nothing from the
 * home to hand: the funeral home's number is in the message that brought
 * her here, and the page says so.
 */
export class CrashBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportCrash("family", "render", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-6 py-12">
        <div className="space-y-4 text-center">
          <h1 className="font-display text-2xl">
            This page didn't open properly
          </h1>
          <p className="leading-relaxed text-muted-foreground">
            Nothing you have added has been lost. Please try opening it again.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            If you need someone now, call the funeral home. Their number is in
            the message that brought you here.
          </p>
          <Button size="lg" onClick={() => window.location.reload()}>
            Open it again
          </Button>
        </div>
      </main>
    );
  }
}

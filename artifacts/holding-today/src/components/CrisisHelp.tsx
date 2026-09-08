import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { LifeBuoy, Phone, MessageSquare, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The crisis numbers, and a button that is on every page of this site.
 *
 * Mounted once in `App.tsx`, above the auth gate, so it renders on the public
 * welcome page and the sign-in form as much as on someone's private journal.
 * A parent who reaches the moment this is for does not first sign in.
 *
 * It is one tap on purpose. Not a menu item behind a hamburger, not a link at
 * the bottom of the healing guide — a button that is already on the screen,
 * and behind it numbers that dial and text directly rather than a page about
 * how to find help.
 */

type Line = {
  label: string;
  detail: string;
  action: { href: string; text: string; icon: typeof Phone };
};

const LINES: Line[] = [
  {
    label: "988 — Suicide & Crisis Lifeline",
    detail:
      "Free, 24 hours a day, every day, anywhere in the US. A person answers. You do not have to be suicidal to call it, and you do not have to know what to say.",
    action: { href: "tel:988", text: "Call 988", icon: Phone },
  },
  {
    label: "988 by text",
    detail:
      "If saying it out loud is too much, text instead. Same service, same people.",
    action: { href: "sms:988", text: "Text 988", icon: MessageSquare },
  },
  {
    label: "Crisis Text Line — 741741",
    detail:
      "Text HOME to 741741 and a trained volunteer texts back. Also free and 24/7.",
    action: { href: "sms:741741?&body=HOME", text: "Text 741741", icon: MessageSquare },
  },
];

function CrisisDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl border-white/10 max-h-[85vh] overflow-y-auto">
        <DialogTitle className="font-display text-2xl pr-6">
          Someone is there right now.
        </DialogTitle>

        <p className="text-muted-foreground leading-relaxed text-sm">
          You do not have to explain yourself, and you do not have to be in
          danger to use any of these. "My child died and I cannot do this" is
          enough of a reason.
        </p>

        <div className="space-y-3 mt-1">
          {LINES.map((line) => {
            const Icon = line.action.icon;
            return (
              <div
                key={line.label}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <p className="font-medium text-foreground mb-1">{line.label}</p>
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                  {line.detail}
                </p>
                <a
                  href={line.action.href}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary/20 text-primary px-4 py-2.5 text-sm font-medium hover:bg-primary/30 transition-colors"
                >
                  <Icon className="w-4 h-4" />
                  {line.action.text}
                </a>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="font-medium text-foreground mb-1 flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground" />
            Outside the US
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <a
              href="https://findahelpline.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              findahelpline.com
            </a>{" "}
            lists the free crisis line for your country.
          </p>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">
          If you are in immediate danger, call <span className="text-foreground">911</span>. If
          it is not that, and you just cannot be alone with it — call one of the
          numbers above anyway. That is what they are for.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The button itself. `variant` only changes how it looks; every variant opens
 * the same dialog in one tap.
 *
 * - `floating` is the global one, fixed to the bottom of the viewport.
 * - `inline` is for placing at the top of a page that is about this, like the
 *   healing guide.
 */
export function CrisisButton({
  variant = "floating",
  className,
  children,
}: {
  variant?: "floating" | "inline";
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex items-center gap-2 font-medium transition-colors",
          variant === "floating" &&
            // Above the mobile drawer overlay (z-50) so it stays reachable
            // with the menu open, and offset from the right edge so it does
            // not sit under a thumb resting on the scrollbar.
            "fixed bottom-4 right-4 z-[60] rounded-full px-4 py-3 text-sm shadow-lg shadow-black/50 " +
              "bg-rose-500/90 text-white hover:bg-rose-500 backdrop-blur-sm border border-white/10",
          variant === "inline" &&
            "rounded-xl px-4 py-2.5 text-sm bg-rose-500/15 text-rose-200 border border-rose-400/25 hover:bg-rose-500/25",
          className,
        )}
      >
        <LifeBuoy className="w-4 h-4 flex-shrink-0" />
        {children ?? "Need someone now"}
      </button>

      <CrisisDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * The same numbers as flat text, for the top of the healing guide and the
 * chapter about not wanting to be here. Someone reading those pages should
 * not have to open anything.
 */
export function CrisisLine({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-rose-400/25 bg-rose-500/10 p-5 md:p-6",
        className,
      )}
    >
      <p className="text-foreground/90 leading-relaxed">
        If you are having thoughts of ending your life, or you just cannot be
        alone with this right now:{" "}
        <a href="tel:988" className="text-rose-200 font-medium hover:underline">
          call or text 988
        </a>{" "}
        (US, 24/7), or text HOME to{" "}
        <a
          href="sms:741741?&body=HOME"
          className="text-rose-200 font-medium hover:underline"
        >
          741741
        </a>
        . Outside the US,{" "}
        <a
          href="https://findahelpline.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-rose-200 font-medium hover:underline"
        >
          findahelpline.com
        </a>
        . You do not have to be in danger to call. You do not have to know what
        to say.
      </p>
    </div>
  );
}

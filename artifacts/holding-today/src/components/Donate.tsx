import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CASHAPP_HANDLE,
  VENMO_HANDLE,
  supportCopy,
} from "@/content/about";

/**
 * Keeping the lights on.
 *
 * Named at a real number rather than asked for in the abstract: "$75 a month
 * for hosting and the domain" is something a reader can decide about, where
 * "support us" is only a request. It also makes the ceiling obvious — this is
 * a site's running costs, not a fundraiser.
 *
 * The panel says the site is free first and asks second, in that order, and
 * nothing anywhere is gated behind having given anything.
 */
export function Donate({ className }: { className?: string }) {
  return (
    <section
      className={cn("glass-panel rounded-3xl p-7 md:p-10", className)}
      aria-labelledby="support-heading"
    >
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
          <Heart className="w-5 h-5 text-primary/80" />
        </div>
        <h2 id="support-heading" className="font-display text-2xl md:text-3xl">
          {supportCopy.heading}
        </h2>
      </div>

      <div className="space-y-4 text-muted-foreground leading-relaxed max-w-2xl">
        {supportCopy.lines.map((line, i) => (
          <p key={i} className={i === 0 ? "text-foreground/90" : undefined}>
            {line}
          </p>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8 max-w-lg">
        <a
          href={`https://venmo.com/u/${VENMO_HANDLE}`}
          target="_blank"
          rel="noopener noreferrer"
          className="group rounded-2xl border border-white/10 bg-background/40 px-5 py-4 transition-colors hover:border-primary/40 hover:bg-background/70"
        >
          <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Venmo
          </span>
          <span className="block font-medium text-foreground group-hover:text-primary transition-colors">
            @{VENMO_HANDLE}
          </span>
        </a>

        <a
          href={`https://cash.app/$${CASHAPP_HANDLE}`}
          target="_blank"
          rel="noopener noreferrer"
          className="group rounded-2xl border border-white/10 bg-background/40 px-5 py-4 transition-colors hover:border-primary/40 hover:bg-background/70"
        >
          <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Cash App
          </span>
          <span className="block font-medium text-foreground group-hover:text-primary transition-colors">
            ${CASHAPP_HANDLE}
          </span>
        </a>
      </div>

      <p className="text-sm text-muted-foreground/80 mt-6">
        If you have nothing to give, please use it anyway. That is what it is
        for.
      </p>
    </section>
  );
}

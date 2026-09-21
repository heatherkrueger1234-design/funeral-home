import { Link } from "wouter";
import { Compass } from "lucide-react";

/**
 * A wrong address, said in a way that does not make somebody feel they have
 * broken something. No "404", no error colour, and the way back is the only
 * thing on the screen.
 */
export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center py-10">
      <div className="max-w-sm text-center">
        <span className="mx-auto mb-5 grid size-12 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-deep)]">
          <Compass className="size-6" strokeWidth={1.5} />
        </span>
        <h1 className="font-display text-[1.6rem] leading-tight">
          That page isn't here
        </h1>
        <p className="mt-2 text-muted-foreground">
          Nothing is wrong, and nothing you have added has been lost.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm font-semibold text-[var(--accent-deep)] decoration-[var(--accent)]/40 underline-offset-4 hover:decoration-[var(--accent)]"
        >
          Back to everything else
        </Link>
      </div>
    </div>
  );
}

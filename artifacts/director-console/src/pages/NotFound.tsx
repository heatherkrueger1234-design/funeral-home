import { Link } from "wouter";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <div className="max-w-sm text-center">
        <span className="mx-auto mb-5 grid size-12 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-deep)]">
          <Compass className="size-6" strokeWidth={1.5} />
        </span>
        <h1 className="font-display text-2xl leading-tight">
          That page isn't here
        </h1>
        <p className="mt-2 text-muted-foreground">
          Nothing is wrong. The address may have changed, or been mistyped.
        </p>
        <Link
          href="/cases"
          className="mt-6 inline-block text-sm font-semibold text-[var(--accent-deep)] decoration-[var(--accent)]/40 underline-offset-4 hover:decoration-[var(--accent)]"
        >
          Back to the cases
        </Link>
      </div>
    </div>
  );
}

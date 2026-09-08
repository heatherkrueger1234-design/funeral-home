import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="font-display text-2xl mb-2">That page isn't here</h1>
      <p className="text-muted-foreground mb-6">
        Nothing is wrong, and nothing you have added has been lost.
      </p>
      <Link href="/" className="text-[var(--accent-deep)] underline">
        Back to everything else
      </Link>
    </div>
  );
}

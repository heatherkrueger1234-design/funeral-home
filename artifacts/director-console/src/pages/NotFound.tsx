import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="font-display text-2xl mb-2">That page isn't here</h1>
      <Link href="/" className="text-[var(--accent-deep)] underline">
        Back to the cases
      </Link>
    </div>
  );
}

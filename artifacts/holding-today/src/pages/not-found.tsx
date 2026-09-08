import { PageLayout } from "@/components/layout/PageLayout";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageLayout>
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <h1 className="text-6xl font-display text-primary mb-4 glow-text">404</h1>
        <h2 className="text-2xl font-medium mb-4">Wandering off the path</h2>
        <p className="text-muted-foreground max-w-md mb-8">
          The page you're looking for doesn't exist. Let's guide you back to your sanctuary.
        </p>
        <Link href="/">
          <Button className="bg-primary text-primary-foreground rounded-full px-8">
            Return Home
          </Button>
        </Link>
      </div>
    </PageLayout>
  );
}

import { type ReactNode } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { PageLayout } from "./PageLayout";
import { CrisisLine } from "@/components/CrisisHelp";
import { useSession } from "@/lib/session";

/**
 * The frame for the written guides.
 *
 * These pages are readable without an account — that is the whole point of
 * them, because the parent who needs the chapter on viewing a body is standing
 * in a hospital corridor and is not about to register for anything. But the
 * same pages are also part of the app for someone signed in, who should get
 * their normal navigation rather than being dropped onto a stripped page.
 *
 * So the layout asks who is reading: signed in gets the sidebar, signed out
 * gets a clean page and a way back to the front door. The content is identical
 * either way.
 */
export function GuideLayout({
  title,
  intro,
  crisisLine = false,
  children,
}: {
  title: string;
  intro: string;
  /** Puts the crisis numbers at the top, in full, before anything else. */
  crisisLine?: boolean;
  children: ReactNode;
}) {
  const { user } = useSession();

  const header = (
    <>
      <h1 className="font-display text-3xl md:text-4xl text-foreground glow-text mb-3">
        {title}
      </h1>
      <p className="text-muted-foreground text-lg leading-relaxed max-w-2xl">
        {intro}
      </p>
      {crisisLine && <CrisisLine className="mt-6" />}
      <div className="mt-8 mb-8 border-b border-white/10" />
    </>
  );

  if (user) {
    return (
      <PageLayout>
        {header}
        {children}
      </PageLayout>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 py-10 md:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-9"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          {header}
          {children}

          <div className="mt-16 pt-8 border-t border-white/10">
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Nothing on this page needs an account. If you want somewhere
              private to keep what you are writing down, there is one here, and
              it is free.
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <Link href="/" className="text-primary hover:underline">
                Holding Today
              </Link>
              <Link
                href="/privacy"
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                Terms
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

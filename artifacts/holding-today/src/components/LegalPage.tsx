import { type ReactNode } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";

/**
 * Contact address for privacy and terms questions.
 *
 * A privacy policy has to name a way to reach a human. Set this to whichever
 * address should receive those — ideally one that is not a personal inbox,
 * because it goes on a public page.
 */
export const CONTACT_EMAIL = "Holdingtodayapp@gmail.com";

export const LAST_UPDATED = "28 August 2026";

export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-5 py-12 md:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-10"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </Link>

        <motion.article
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <h1 className="font-display text-3xl md:text-4xl mb-4">{title}</h1>
          <p className="text-muted-foreground leading-relaxed mb-2">{intro}</p>
          <p className="text-xs text-muted-foreground/60 mb-10">
            Last updated {LAST_UPDATED}.
          </p>

          <div className="space-y-9">{children}</div>

          <div className="mt-14 pt-8 border-t border-white/10 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/privacy" className="text-muted-foreground hover:text-primary transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="text-muted-foreground hover:text-primary transition-colors">
              Terms
            </Link>
            <Link href="/" className="text-muted-foreground hover:text-primary transition-colors">
              Home
            </Link>
          </div>
        </motion.article>
      </div>
    </div>
  );
}

export function Section({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-xl md:text-2xl mb-3">{heading}</h2>
      <div className="space-y-3 text-muted-foreground leading-relaxed">
        {children}
      </div>
    </section>
  );
}

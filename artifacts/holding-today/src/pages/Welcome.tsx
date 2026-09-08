import { Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { asset } from "@/lib/assets";
import { Donate } from "@/components/Donate";
import {
  aboutClosing,
  aboutEthan,
  aboutParagraphs,
  aboutPurpose,
  aboutSignature,
} from "@/content/about";
import {
  BookOpen,
  FileText,
  Heart,
  Image as ImageIcon,
  LifeBuoy,
  Mail,
  Map,
  Users,
} from "lucide-react";

const PLATITUDES = [
  "I can't imagine…",
  "At least you can have more.",
  "At least you have another child.",
  "They're in a better place.",
  "They're at peace now.",
  "Now they'll be waiting for you.",
  "Now you don't have to worry about them.",
  "Let me know if you need anything.",
  "Time heals all wounds.",
  "Tomorrow will be better.",
];

const HOLDS = [
  { icon: ImageIcon, label: "A wall of photos" },
  { icon: BookOpen, label: "A journal for the days" },
  { icon: Mail, label: "Letters to them, and from them" },
  { icon: Heart, label: "Who they were — the small things" },
  { icon: FileText, label: "The hard paperwork, in one place" },
  { icon: Map, label: "A timeline, including the days they never reached" },
  { icon: Users, label: "Stories other people remember" },
  { icon: LifeBuoy, label: "A guide for what grief actually does" },
];

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: "easeOut" as const },
};

export default function Welcome() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ---------------------------------------------------------------- */}
      <header className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.18] bg-cover bg-center"
          style={{ backgroundImage: `url(${asset("images/hero-bg.png")})` }}
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/85 to-background"
        />

        <div className="relative max-w-4xl mx-auto px-5 pt-16 pb-14 md:pt-28 md:pb-20 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            className="w-16 h-16 rounded-full bg-secondary/70 border-2 border-primary/30 flex items-center justify-center mx-auto mb-8 shadow-[0_0_28px_rgba(14,165,233,0.28)]"
          >
            <Heart className="w-7 h-7 text-primary/70" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1, ease: "easeOut" }}
            className="font-display text-3xl sm:text-4xl md:text-5xl leading-tight mb-6 text-balance"
          >
            Welcome to a club no one
            <br className="hidden sm:block" /> should ever have to join.
          </motion.h1>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="space-y-5 text-base md:text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto"
          >
            <p>
              I know you would have given your last breath to give your child
              one more breath.
            </p>
            <p>
              Right now you are in disbelief, shock, numb, scared, angry,
              hysterical — or far too calm. Or you just feel like you are in a
              dream.
            </p>
            <p className="text-foreground/90">
              I wish that I could wave a wand and give them back to you right
              now. I wish I could wave a wand and get mine back.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.5 }}
            className="flex flex-col sm:flex-row gap-3 justify-center mt-10"
          >
            <Link href="/signin">
              <Button
                size="lg"
                className="w-full sm:w-auto bg-primary text-primary-foreground rounded-full px-8 shadow-lg shadow-primary/20"
              >
                Make a place for them
              </Button>
            </Link>
            <a href="#why">
              <Button
                size="lg"
                variant="secondary"
                className="w-full sm:w-auto rounded-full px-8"
              >
                Why this exists
              </Button>
            </a>
          </motion.div>
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/*
        Heather's own words. Rendered from src/content/about.ts and not to be
        edited here — see the note at the top of that file.
      */}
      <section id="why" className="border-y border-white/5 bg-secondary/10 scroll-mt-8">
        <div className="max-w-3xl mx-auto px-5 py-14 md:py-20">
          <motion.div {...fadeUp}>
            <p className="text-sm uppercase tracking-[0.2em] text-primary/60 mb-3">
              Why this exists
            </p>

            <div className="space-y-5 text-muted-foreground leading-relaxed">
              {aboutParagraphs.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>

            <div className="space-y-5 text-muted-foreground leading-relaxed mt-8">
              {aboutEthan.map((line, i) => (
                <p key={line} className={i === 0 ? "text-foreground text-xl font-display" : undefined}>
                  {line}
                </p>
              ))}
            </div>
          </motion.div>

          <motion.div {...fadeUp} className="mt-12">
            <h3 className="font-display text-xl md:text-2xl mb-6">
              What this platform is for
            </h3>
            <div className="space-y-3">
              {aboutPurpose.map((item) => (
                <div
                  key={item.heading}
                  className="rounded-2xl border border-white/10 bg-background/40 px-5 py-4"
                >
                  <p className="text-foreground/90 font-medium mb-1">
                    {item.heading}
                  </p>
                  <p className="text-muted-foreground leading-relaxed text-sm">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div {...fadeUp} className="mt-12">
            <div className="space-y-5 text-muted-foreground leading-relaxed">
              {aboutClosing.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>

            <div className="mt-9 text-muted-foreground">
              <p>{aboutSignature.closing}</p>
              <p className="text-foreground/90 font-display text-lg mt-1">
                {aboutSignature.name}
              </p>
              <p className="text-sm text-primary/70 mt-2">
                {aboutSignature.dedication}
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <motion.section {...fadeUp} className="max-w-3xl mx-auto px-5 py-14 md:py-20">
        <h2 className="font-display text-2xl md:text-3xl mb-7">
          The things people will say
        </h2>

        <ul className="space-y-2.5 mb-8">
          {PLATITUDES.map((line) => (
            <li
              key={line}
              className="border-l-2 border-white/10 pl-4 py-1 text-muted-foreground italic"
            >
              “{line}”
            </li>
          ))}
        </ul>

        <div className="space-y-5 text-muted-foreground leading-relaxed">
          <p>
            <span className="text-foreground/90">“I can't imagine…”</span> — no,
            neither can I.
          </p>
          <p>
            <span className="text-foreground/90">
              “Let me know if you need anything”
            </span>{" "}
            — as if you even know what you need.
          </p>
          <p>
            They all land with a bitter irony. And you know people mean well,
            that they want to find some peace for you. But it is all just a
            foggy haze.
          </p>
          <p>
            Some people end up in hospital having their vitals checked because
            nothing feels real. Convinced they have died and are in hell but do
            not know it yet.
          </p>
          <p className="text-foreground/90 text-lg">Turns out — it's all real.</p>
        </div>
      </motion.section>

      {/* ---------------------------------------------------------------- */}
      {/* ---------------------------------------------------------------- */}
      <motion.section {...fadeUp} className="max-w-5xl mx-auto px-5 py-14 md:py-20">
        <h2 className="font-display text-2xl md:text-3xl mb-3">
          What you can keep here
        </h2>
        <p className="text-muted-foreground mb-9 max-w-2xl">
          Everything you write is private to your account. No one else can see
          it — not other families, not visitors. You can download all of it, or
          delete all of it, at any time, without asking anyone.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {HOLDS.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-3.5 rounded-2xl border border-white/10 bg-background/40 px-5 py-4"
            >
              <Icon className="w-5 h-5 text-primary/70 flex-shrink-0" />
              <span className="text-sm text-foreground/90">{label}</span>
            </div>
          ))}
        </div>

        <div className="mt-9">
          <Link href="/signin">
            <Button
              size="lg"
              className="w-full sm:w-auto bg-primary text-primary-foreground rounded-full px-8 shadow-lg shadow-primary/20"
            >
              Make a place for them
            </Button>
          </Link>
        </div>
      </motion.section>

      {/* ---------------------------------------------------------------- */}
      <motion.div {...fadeUp} className="max-w-5xl mx-auto px-5 pb-14 md:pb-20">
        <Donate />
      </motion.div>

      {/* ---------------------------------------------------------------- */}
      <footer className="border-t border-white/5">
        <div className="max-w-3xl mx-auto px-5 py-12 text-center space-y-6">
          <div className="rounded-2xl border border-primary/20 bg-primary/5 px-6 py-5">
            <p className="text-sm text-foreground/90 leading-relaxed">
              If you are in crisis or having thoughts of ending your life,
              please reach out. Call or text{" "}
              <a href="tel:988" className="text-primary font-medium hover:underline">
                988
              </a>{" "}
              (US), available 24/7. You are not alone.
            </p>
          </div>

          <p className="text-sm text-muted-foreground">
            {aboutSignature.closing} {aboutSignature.name} ·{" "}
            {aboutSignature.dedication}
          </p>

          <p className="text-xs text-muted-foreground/60">
            Holding Today · Everything you need, in one place, on the days you can't.
          </p>

          <div className="flex flex-wrap gap-x-6 gap-y-2 justify-center text-xs">
            <Link
              href="/privacy"
              className="text-muted-foreground/70 hover:text-primary transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-muted-foreground/70 hover:text-primary transition-colors"
            >
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

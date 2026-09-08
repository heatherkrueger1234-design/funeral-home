import { Heart } from "lucide-react";
import { motion } from "framer-motion";
import { GuideLayout } from "@/components/layout/GuideLayout";
import { ChapterGroups } from "@/components/Chapters";
import { GuideSearch } from "@/components/GuideSearch";
import { healingGroups, healingIntro } from "@/content/healing";

export default function Healing() {
  return (
    <GuideLayout title="What to expect" intro={healingIntro} crisisLine>
      <GuideSearch />

      <ChapterGroups groups={healingGroups} />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="glass-panel mt-10 p-8 rounded-3xl text-center border border-primary/20"
      >
        <Heart className="w-8 h-8 text-primary mx-auto mb-4" />
        <p className="text-foreground/80 leading-relaxed text-lg">
          "Grief is just love with no place to go."
        </p>
        <p className="text-primary/60 text-sm mt-2">— Jamie Anderson</p>
      </motion.div>
    </GuideLayout>
  );
}

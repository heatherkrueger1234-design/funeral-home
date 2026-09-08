import { Link } from "wouter";
import { motion } from "framer-motion";
import { Cake, CalendarHeart, Flame, CalendarDays } from "lucide-react";
import {
  computeUpcoming,
  describeDaysAway,
  type MilestoneSource,
  type UpcomingKind,
} from "@/lib/upcoming";
import { formatDate } from "@/lib/utils";

const ICONS: Record<UpcomingKind, typeof Cake> = {
  birthday: Cake,
  angelversary: Flame,
  milestone: CalendarHeart,
  holiday: CalendarDays,
};

type UpcomingProps = {
  childName?: string | null;
  childBirthDate?: string | null;
  childPassingDate?: string | null;
  milestones?: MilestoneSource[];
};

export function Upcoming(props: UpcomingProps) {
  const items = computeUpcoming(props);

  // Nothing coming is the common case for most of the year, and an empty
  // "nothing upcoming" card would be a small weekly reminder of absence.
  if (items.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mb-10"
      aria-label="Coming up"
    >
      <h2 className="text-sm uppercase tracking-[0.18em] text-primary/60 mb-4">
        Coming up
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.slice(0, 3).map((item) => {
          const Icon = ICONS[item.kind];
          // Only the heavy dates get the glow. A dentist appointment lighting
          // up the same way as the anniversary of a child's death would be a
          // small, daily insult.
          const isSoon = item.daysAway <= 7 && item.heavy;

          return (
            <div
              key={item.key}
              className={`glass-panel rounded-2xl p-5 flex items-start gap-3.5 ${
                isSoon ? "border-primary/30 glow-border" : ""
              }`}
            >
              <div className="p-2.5 bg-primary/10 rounded-xl h-fit flex-shrink-0">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-primary/70 mb-1">
                  {describeDaysAway(item.daysAway)}
                </p>
                <p className="font-medium text-foreground break-words">
                  {item.title}
                </p>
                {item.detail && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {item.detail}
                  </p>
                )}
                <p className="text-xs text-muted-foreground/60 mt-1.5">
                  {formatDate(item.date.toISOString().slice(0, 10))}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <Link
        href="/milestones"
        className="inline-block mt-3 text-sm text-muted-foreground hover:text-primary transition-colors"
      >
        See the whole timeline →
      </Link>
    </motion.section>
  );
}

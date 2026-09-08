import { useMemo } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import {
  useGetProfile,
  useGetMemories,
  useGetJournalEntries,
  useGetAffirmations,
  useGetMilestones,
} from "@workspace/api-client-react";
import { Upcoming } from "@/components/Upcoming";
import { FirstRun } from "@/components/FirstRun";
import { SmallThings } from "@/components/SmallThings";
import { SomethingYouWrote } from "@/components/SomethingYouWrote";
import { WhoAreYouHereFor } from "@/components/WhoAreYouHereFor";
import { DEFAULT_CHILD_NAME } from "@/lib/upcoming";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Heart, Image as ImageIcon, BookOpen, Quote } from "lucide-react";
import { motion } from "framer-motion";

export default function Home() {
  const { data: profile } = useGetProfile();
  const { data: memories } = useGetMemories();
  const { data: journal } = useGetJournalEntries();
  const { data: affirmations } = useGetAffirmations();
  const { data: milestones } = useGetMilestones();
  const { refetch: refetchProfile } = useGetProfile();

  const recentMemory = memories?.[0];
  const recentJournal = journal?.[0];
  // Picked once per day. Calling Math.random() during render meant the
  // affirmation changed on every re-render instead of staying put.
  const dailyAffirmation = useMemo(() => {
    if (!affirmations?.length) return undefined;
    const dayIndex = Math.floor(Date.now() / 86_400_000);
    return affirmations[dayIndex % affirmations.length];
  }, [affirmations]);

  // The profile row is created automatically with a placeholder name, so
  // "has this account said anything yet" is the placeholder still being there.
  const needsSetup =
    !profile?.childName || profile.childName === DEFAULT_CHILD_NAME;

  // Deliberately outside PageLayout: showing the full menu here would put
  // the wall of empty rooms back on the screen the moment this exists to
  // replace it.
  if (needsSetup) {
    return (
      <div className="min-h-screen bg-background text-foreground px-5">
        <FirstRun onDone={() => void refetchProfile()} />
      </div>
    );
  }

  return (
    <PageLayout>
      <div className="relative rounded-3xl overflow-hidden mb-12 shadow-2xl shadow-black/50">
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent z-10" />
        <img 
          src={`${import.meta.env.BASE_URL}images/hero-bg.png`} 
          alt="Ethereal background" 
          className="absolute inset-0 w-full h-full object-cover opacity-60 mix-blend-screen"
        />
        
        <div className="relative z-20 p-8 md:p-12 lg:p-16">
          <h1 className="text-4xl md:text-6xl font-display font-medium text-white mb-4 glow-text">
            {profile?.childName ? `Honoring ${profile.childName}` : "A Sacred Space"}
          </h1>
          <p className="text-xl text-blue-100/80 max-w-2xl leading-relaxed mb-8">
            This is your private sanctuary. A place to remember, to cry, to write, and to hold their memory close to your heart forever.
          </p>
        </div>
      </div>

      <Upcoming
        childName={profile?.childName}
        childBirthDate={profile?.childBirthDate}
        childPassingDate={profile?.childPassingDate}
        milestones={milestones}
      />

      <WhoAreYouHereFor />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-10">
        <SmallThings />
        <div className="space-y-4">
          <SomethingYouWrote />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Memories Card */}
        <motion.div whileHover={{ y: -4 }} className="glass-panel rounded-2xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
            <ImageIcon className="w-24 h-24 text-primary" />
          </div>
          <h3 className="text-xl font-display mb-4 flex items-center gap-2 text-foreground">
            <ImageIcon className="w-5 h-5 text-primary" /> Recent Memory
          </h3>
          {recentMemory ? (
            <div>
              {recentMemory.imageUrl && (
                <div className="aspect-video rounded-xl overflow-hidden mb-4">
                  <img src={recentMemory.imageUrl} alt={recentMemory.title} className="w-full h-full object-cover" />
                </div>
              )}
              <p className="font-medium">{recentMemory.title}</p>
            </div>
          ) : (
            <p className="text-muted-foreground mb-6">No memories added yet.</p>
          )}
          <Link href="/memories" className="mt-4 inline-block text-primary hover:text-primary/80 font-medium">
            View Memory Wall →
          </Link>
        </motion.div>

        {/* Journal Card */}
        <motion.div whileHover={{ y: -4 }} className="glass-panel rounded-2xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
            <BookOpen className="w-24 h-24 text-primary" />
          </div>
          <h3 className="text-xl font-display mb-4 flex items-center gap-2 text-foreground">
            <BookOpen className="w-5 h-5 text-primary" /> Latest Journal Entry
          </h3>
          {recentJournal ? (
            <div>
              <p className="font-medium mb-2">{recentJournal.title}</p>
              <p className="text-muted-foreground line-clamp-3 text-sm">{recentJournal.content}</p>
            </div>
          ) : (
            <p className="text-muted-foreground mb-6">Your journal is empty.</p>
          )}
          <Link href="/journal" className="mt-4 inline-block text-primary hover:text-primary/80 font-medium absolute bottom-6">
            Open Journal →
          </Link>
        </motion.div>

        {/* Affirmation Card */}
        <motion.div whileHover={{ y: -4 }} className="glass-panel rounded-2xl p-6 relative overflow-hidden group md:col-span-2 lg:col-span-1 border-primary/20 glow-border">
          <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
            <Quote className="w-24 h-24 text-primary" />
          </div>
          <h3 className="text-xl font-display mb-4 flex items-center gap-2 text-foreground">
            <Heart className="w-5 h-5 text-primary" /> Gentle Reminder
          </h3>
          <div className="h-full flex flex-col justify-center pb-8">
            <p className="text-lg font-display italic text-foreground/90 leading-relaxed">
              "{dailyAffirmation?.text || "Grief is just love with no place to go. Be gentle with yourself today."}"
            </p>
          </div>
        </motion.div>
      </div>
    </PageLayout>
  );
}

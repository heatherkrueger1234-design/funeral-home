import { useState } from "react";
import { motion } from "framer-motion";
import { useUpdateProfile } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Heart, Loader2 } from "lucide-react";

/**
 * What a brand-new account sees instead of the dashboard.
 *
 * The alternative — which this replaces — was eighteen menu items and a
 * dozen "nothing here yet" panels, presented to someone who may be days into
 * the worst thing that will ever happen to them. That is not a blank canvas,
 * it is a demand.
 *
 * So the first screen asks for one thing, and everything else stays out of
 * the way until it has an answer. The dates are optional and only asked
 * because knowing them is what lets the app say "his birthday is next week"
 * before the date arrives unannounced.
 */
export function FirstRun({ onDone }: { onDone: () => void }) {
  const [childName, setChildName] = useState("");
  const [childBirthDate, setChildBirthDate] = useState("");
  const [childPassingDate, setChildPassingDate] = useState("");
  const { mutate: updateProfile, isPending } = useUpdateProfile();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    updateProfile(
      {
        data: {
          childName: childName.trim(),
          childBirthDate: childBirthDate || null,
          childPassingDate: childPassingDate || null,
        },
      },
      { onSuccess: onDone },
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="max-w-lg mx-auto py-8 md:py-16"
    >
      <div className="text-center mb-9">
        <div className="w-16 h-16 rounded-full bg-secondary border-2 border-primary/30 flex items-center justify-center mx-auto mb-6 shadow-[0_0_24px_rgba(14,165,233,0.28)]">
          <Heart className="w-7 h-7 text-primary/70" />
        </div>
        <h1 className="font-display text-3xl md:text-4xl mb-4">
          Let's start with their name.
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          That is all this needs to begin. Everything else can wait for a day
          when you have more in you — nothing here has to be finished, and
          nothing is lost if you stop.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="glass-panel rounded-3xl p-6 md:p-8 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="childName">Their name</Label>
          <Input
            id="childName"
            required
            autoFocus
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            className="bg-background border-white/10 text-lg"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="childBirthDate">The day they were born</Label>
            <Input
              id="childBirthDate"
              type="date"
              value={childBirthDate}
              onChange={(e) => setChildBirthDate(e.target.value)}
              className="bg-background border-white/10"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="childPassingDate">The day you lost them</Label>
            <Input
              id="childPassingDate"
              type="date"
              value={childPassingDate}
              onChange={(e) => setChildPassingDate(e.target.value)}
              className="bg-background border-white/10"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground/70 leading-relaxed">
          The dates are optional. They are only asked so this place can tell you
          a birthday is coming before it arrives without warning.
        </p>

        <Button
          type="submit"
          disabled={isPending || childName.trim() === ""}
          className="w-full bg-primary text-primary-foreground rounded-full"
          size="lg"
        >
          {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Make their place
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground/60 mt-6">
        Only you can see what you write here.
      </p>
    </motion.div>
  );
}

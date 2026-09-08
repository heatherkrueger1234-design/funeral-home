import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useGetMilestones, useCreateMilestone, useDeleteMilestone } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Map, Plus, Trash2, Heart, Star, Cake, Calendar, Flower, Flame, CalendarDays, GraduationCap, Users } from "lucide-react";
import { motion } from "framer-motion";
import { formatDate } from "@/lib/utils";

const milestoneTypes = [
  "birthday", "deathday", "anniversary", "holiday", "graduation",
  "sibling", "achievement", "memory", "healing", "other",
] as const;

const typeConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  birthday: { label: "Birthday", color: "bg-rose-400/20 border-rose-400/40 text-rose-300", icon: Cake },
  deathday: { label: "The day", color: "bg-indigo-400/20 border-indigo-400/40 text-indigo-300", icon: Flame },
  anniversary: { label: "Anniversary", color: "bg-purple-400/20 border-purple-400/40 text-purple-300", icon: Calendar },
  holiday: { label: "Holiday", color: "bg-teal-400/20 border-teal-400/40 text-teal-300", icon: CalendarDays },
  graduation: { label: "The year they would have", color: "bg-sky-400/20 border-sky-400/40 text-sky-300", icon: GraduationCap },
  sibling: { label: "A brother or sister", color: "bg-pink-400/20 border-pink-400/40 text-pink-300", icon: Users },
  achievement: { label: "Achievement", color: "bg-amber-400/20 border-amber-400/40 text-amber-300", icon: Star },
  memory: { label: "Memory", color: "bg-blue-400/20 border-blue-400/40 text-blue-300", icon: Heart },
  healing: { label: "Healing", color: "bg-emerald-400/20 border-emerald-400/40 text-emerald-300", icon: Flower },
  other: { label: "Other", color: "bg-white/10 border-white/20 text-muted-foreground", icon: Map },
};

/** Types that come round every year unless told otherwise. */
const USUALLY_RECURRING = new Set(["birthday", "deathday", "anniversary", "holiday"]);

export default function Milestones() {
  const { data: milestones, refetch } = useGetMilestones();
  const { mutate: createMilestone, isPending } = useCreateMilestone();
  const { mutate: deleteMilestone } = useDeleteMilestone();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    milestoneDate: "",
    type: "memory" as typeof milestoneTypes[number],
    isChildMilestone: true,
    recurring: false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMilestone({ data: form }, {
      onSuccess: () => {
        toast({ title: "Milestone added to your timeline" });
        setIsOpen(false);
        setForm({
          title: "",
          description: "",
          milestoneDate: "",
          type: "memory",
          isChildMilestone: true,
          recurring: false,
        });
        refetch();
      }
    });
  };

  return (
    <PageLayout>
      <PageHeader
        title="The calendar"
        description="The dates that are coming. You will be told before they arrive, not on the morning."
        action={
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground rounded-full px-6 shadow-lg">
                <Plus className="w-4 h-4 mr-2" /> Add Milestone
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-white/10 text-foreground sm:max-w-[600px]">
              <DialogHeader><DialogTitle className="font-display text-2xl">Add to Timeline</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title" required className="bg-background border-white/10" />
                <Input type="date" value={form.milestoneDate} onChange={e => setForm({ ...form, milestoneDate: e.target.value })} required className="bg-background border-white/10" />
                <div className="flex flex-wrap gap-2">
                  {milestoneTypes.map(t => (
                    <button key={t} type="button" onClick={() => setForm({ ...form, type: t, recurring: USUALLY_RECURRING.has(t) })}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${form.type === t ? "bg-primary text-primary-foreground border-primary" : "bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10"}`}>
                      {typeConfig[t].label}
                    </button>
                  ))}
                </div>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="Describe this moment..." className="w-full bg-background border border-white/10 rounded-xl p-3 text-foreground min-h-[100px] resize-none" />
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={form.isChildMilestone} onChange={e => setForm({ ...form, isChildMilestone: e.target.checked })} />
                  This is their milestone (uncheck for your healing journey)
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={form.recurring} onChange={e => setForm({ ...form, recurring: e.target.checked })} />
                  This comes round every year
                </label>
                <Button type="submit" disabled={isPending} className="w-full bg-primary text-primary-foreground">
                  {isPending ? "Saving..." : "Add to Timeline"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {!milestones?.length ? (
        <EmptyState icon={Map} title="Your Shared Timeline" description="Add their birthdays, your anniversaries of loss, and your own healing milestones. Every step matters." />
      ) : (
        <div className="relative">
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary/50 via-primary/20 to-transparent" />
          <div className="space-y-6 pl-16">
            {milestones.map((m, i) => {
              const config = typeConfig[m.type] ?? typeConfig.other;
              const Icon = config.icon;
              return (
                <motion.div key={m.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                  className="relative group">
                  <div className={`absolute -left-12 w-8 h-8 rounded-full border flex items-center justify-center ${config.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="glass-panel p-5 rounded-2xl">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${config.color}`}>{config.label}</span>
                          {!m.isChildMilestone && <span className="text-xs px-2 py-0.5 rounded-full border border-emerald-400/40 text-emerald-300 bg-emerald-400/10">Your Journey</span>}
                          {m.recurring && <span className="text-xs px-2 py-0.5 rounded-full border border-white/15 text-muted-foreground">Every year</span>}
                        </div>
                        <h3 className="text-lg font-display text-foreground">{m.title}</h3>
                        <p className="text-primary/70 text-sm">{formatDate(m.milestoneDate)}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive hover:bg-destructive/20 transition-all"
                        onClick={() => { if (confirm("Remove from timeline?")) deleteMilestone({ id: m.id }, { onSuccess: () => refetch() }); }}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    {m.description && <p className="text-foreground/70 mt-2 text-sm">{m.description}</p>}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </PageLayout>
  );
}

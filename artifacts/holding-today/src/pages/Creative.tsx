import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useGetCreativeWorks, useCreateCreativeWork, useDeleteCreativeWork } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PenTool, Plus, Trash2, Music, BookOpen, Image, Star } from "lucide-react";
import { motion } from "framer-motion";

const types = ["poem", "song", "art", "other"] as const;
const typeLabels: Record<string, string> = { poem: "Poem", song: "Song", art: "Art", other: "Other" };
const typeIcons: Record<string, React.ElementType> = { poem: BookOpen, song: Music, art: Image, other: Star };

export default function Creative() {
  const { data: works, refetch } = useGetCreativeWorks();
  const { mutate: createWork, isPending } = useCreateCreativeWork();
  const { mutate: deleteWork } = useDeleteCreativeWork();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [activeType, setActiveType] = useState<string>("all");

  const [formData, setFormData] = useState({ title: "", content: "", type: "poem" as typeof types[number] });

  const filtered = works?.filter(w => activeType === "all" || w.type === activeType);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createWork({ data: formData }, {
      onSuccess: () => {
        toast({ title: "Saved to your creative collection" });
        setIsOpen(false);
        setFormData({ title: "", content: "", type: "poem" });
        refetch();
      }
    });
  };

  return (
    <PageLayout>
      <PageHeader
        title="My Creative Work"
        description="Poems, songs, and art you've made in their memory. Your love expressed."
        action={
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground rounded-full px-6 shadow-lg">
                <Plus className="w-4 h-4 mr-2" /> Add Work
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-white/10 text-foreground sm:max-w-[700px]">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">Add Creative Work</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                <Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="Title" required className="bg-background border-white/10" />
                <div className="flex gap-2">
                  {types.map(t => (
                    <button key={t} type="button"
                      onClick={() => setFormData({ ...formData, type: t })}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${formData.type === t ? "bg-primary text-primary-foreground" : "bg-white/5 text-muted-foreground hover:bg-white/10"}`}>
                      {typeLabels[t]}
                    </button>
                  ))}
                </div>
                <Textarea value={formData.content} onChange={e => setFormData({ ...formData, content: e.target.value })} placeholder="Write your poem, song lyrics, art description..." required className="bg-background border-white/10 min-h-[280px] resize-none" />
                <Button type="submit" disabled={isPending} className="w-full bg-primary text-primary-foreground">
                  {isPending ? "Saving..." : "Save"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="flex gap-2 mb-8 flex-wrap">
        {["all", ...types].map(t => (
          <button key={t} onClick={() => setActiveType(t)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${activeType === t ? "bg-primary text-primary-foreground" : "bg-white/5 text-muted-foreground hover:bg-white/10"}`}>
            {t === "all" ? "All" : typeLabels[t]}
          </button>
        ))}
      </div>

      {!filtered?.length ? (
        <EmptyState icon={PenTool} title="Your Creative Space" description="Every poem, song, or piece of art you create in their honor lives here. Your love is art." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filtered.map(work => {
            const Icon = typeIcons[work.type] || Star;
            return (
              <motion.div key={work.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="glass-panel p-6 rounded-3xl relative group">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-lg font-display text-foreground">{work.title}</h3>
                      <span className="text-xs text-primary/70 uppercase tracking-wider">{typeLabels[work.type]}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive hover:bg-destructive/20 transition-all"
                    onClick={() => { if (confirm("Delete this work?")) deleteWork({ id: work.id }, { onSuccess: () => refetch() }); }}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-foreground/80 whitespace-pre-wrap leading-relaxed text-sm">{work.content}</p>
              </motion.div>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}

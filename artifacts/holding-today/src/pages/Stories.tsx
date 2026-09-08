import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useGetStories, useCreateStory, useDeleteStory } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Trash2, Heart } from "lucide-react";
import { motion } from "framer-motion";

export default function Stories() {
  const { data: stories, refetch } = useGetStories();
  const { mutate: createStory, isPending } = useCreateStory();
  const { mutate: deleteStory } = useDeleteStory();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({ authorName: "", relationship: "", title: "", content: "" });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createStory({ data: form }, {
      onSuccess: () => {
        toast({ title: "Story shared — thank you" });
        setIsOpen(false);
        setForm({ authorName: "", relationship: "", title: "", content: "" });
        refetch();
      }
    });
  };

  return (
    <PageLayout>
      <PageHeader
        title="Shared Stories"
        description="A place where everyone who loved them can share their memories."
        action={
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground rounded-full px-6 shadow-lg">
                <Plus className="w-4 h-4 mr-2" /> Share a Memory
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-white/10 text-foreground sm:max-w-[700px]">
              <DialogHeader><DialogTitle className="font-display text-2xl">Share a Memory</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <Input value={form.authorName} onChange={e => setForm({ ...form, authorName: e.target.value })} placeholder="Your name" required className="bg-background border-white/10" />
                  <Input value={form.relationship} onChange={e => setForm({ ...form, relationship: e.target.value })} placeholder="Your relationship (e.g. Grandma, Best Friend)" className="bg-background border-white/10" />
                </div>
                <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title for your memory (optional)" className="bg-background border-white/10" />
                <Textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })}
                  placeholder="Share a memory, story, what you loved about them, how they made you feel, a funny moment, anything..."
                  required className="bg-background border-white/10 min-h-[220px] resize-none" />
                <Button type="submit" disabled={isPending} className="w-full bg-primary text-primary-foreground">
                  {isPending ? "Sharing..." : "Share Memory"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="mb-6 glass-panel p-5 rounded-2xl text-center border border-primary/20">
        <Heart className="w-6 h-6 text-primary mx-auto mb-2" />
        <p className="text-foreground/80 text-sm leading-relaxed">
          Invite friends and family to visit this page and share their memories. Every story keeps them alive in our hearts.
        </p>
      </div>

      {!stories?.length ? (
        <EmptyState icon={Users} title="Their Village" description="Everyone who loved them has a story. This is the place for all of them." />
      ) : (
        <div className="space-y-6">
          {stories.map(story => (
            <motion.div key={story.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="glass-panel p-6 md:p-8 rounded-3xl relative group">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary font-display text-lg">
                    {story.authorName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{story.authorName}</p>
                    {story.relationship && <p className="text-primary/70 text-sm">{story.relationship}</p>}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive hover:bg-destructive/20 transition-all"
                  onClick={() => { if (confirm("Remove this story?")) deleteStory({ id: story.id }, { onSuccess: () => refetch() }); }}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              {story.title && <h3 className="font-display text-xl text-foreground mb-3">{story.title}</h3>}
              <p className="text-foreground/80 leading-relaxed whitespace-pre-wrap">{story.content}</p>
            </motion.div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}

import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useGetJournalEntries, useCreateJournalEntry, useDeleteJournalEntry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { BookOpen, PenLine, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { motion } from "framer-motion";

export default function Journal() {
  const { data: entries, refetch } = useGetJournalEntries();
  const { mutate: createEntry, isPending } = useCreateJournalEntry();
  const { mutate: deleteEntry } = useDeleteJournalEntry();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  const [formData, setFormData] = useState({
    title: "",
    content: "",
    entryDate: new Date().toISOString().split('T')[0],
    mood: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createEntry({ data: formData }, {
      onSuccess: () => {
        toast({ title: "Entry saved" });
        setIsOpen(false);
        setFormData({ title: "", content: "", entryDate: new Date().toISOString().split('T')[0], mood: "" });
        refetch();
      }
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this journal entry?")) {
      deleteEntry({ id }, { onSuccess: () => refetch() });
    }
  };

  return (
    <PageLayout>
      <PageHeader 
        title="My Journal" 
        description="Write without filters. Scream, cry, or just talk to them on paper."
        action={
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground rounded-full px-6 shadow-lg">
                <PenLine className="w-4 h-4 mr-2" /> New Entry
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-white/10 text-foreground sm:max-w-[700px]">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">Write an Entry</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Input value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} placeholder="Title" required className="bg-background border-white/10" />
                  </div>
                  <div className="space-y-2">
                    <Input type="date" value={formData.entryDate} onChange={e => setFormData({...formData, entryDate: e.target.value})} required className="bg-background border-white/10" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Textarea value={formData.content} onChange={e => setFormData({...formData, content: e.target.value})} placeholder="What's on your heart today?" required className="bg-background border-white/10 min-h-[250px] resize-none" />
                </div>
                <Button type="submit" disabled={isPending} className="w-full mt-4 bg-primary text-primary-foreground">
                  {isPending ? "Saving..." : "Save Entry"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {!entries?.length ? (
        <EmptyState 
          icon={BookOpen}
          title="Blank Pages"
          description="Your journal is a safe place. There is no right or wrong way to grieve. Start writing whenever you're ready."
        />
      ) : (
        <div className="space-y-6">
          {entries.map((entry) => (
            <motion.div 
              key={entry.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-panel p-6 md:p-8 rounded-3xl relative group"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-2xl font-display text-foreground">{entry.title}</h3>
                  <p className="text-primary/70 text-sm">{formatDate(entry.entryDate)}</p>
                </div>
                <Button variant="ghost" size="icon" className="opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive hover:bg-destructive/20 transition-all" onClick={() => handleDelete(entry.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-foreground/90 whitespace-pre-wrap leading-relaxed text-lg font-light">
                {entry.content}
              </p>
            </motion.div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}

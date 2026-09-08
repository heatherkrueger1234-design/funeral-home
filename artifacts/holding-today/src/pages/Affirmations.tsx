import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useGetAffirmations, useCreateAffirmation, useDeleteAffirmation } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Quote, Plus, Trash2 } from "lucide-react";
import { motion } from "framer-motion";

export default function Affirmations() {
  const { data: affirmations, refetch } = useGetAffirmations();
  const { mutate: createAffirmation, isPending } = useCreateAffirmation();
  const { mutate: deleteAffirmation } = useDeleteAffirmation();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createAffirmation({ data: { text, isFavorite: true } }, {
      onSuccess: () => {
        toast({ title: "Added" });
        setIsOpen(false);
        setText("");
        refetch();
      }
    });
  };

  return (
    <PageLayout>
      <PageHeader 
        title="Daily Affirmations" 
        description="Gentle truths to hold onto when the waves of grief are high."
        action={
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground rounded-full px-6 shadow-lg">
                <Plus className="w-4 h-4 mr-2" /> Add Affirmation
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-white/10 text-foreground">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">Add an Affirmation</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                <Input value={text} onChange={e => setText(e.target.value)} placeholder="e.g., I carry their love with me always..." required className="bg-background border-white/10" />
                <Button type="submit" disabled={isPending} className="w-full bg-primary text-primary-foreground">Save</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {!affirmations?.length ? (
        <EmptyState icon={Quote} title="No affirmations yet" description="Add reminders to be gentle with yourself." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {affirmations.map((a, i) => (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.1 }}
              key={a.id} 
              className="glass-panel p-8 rounded-3xl relative group border-primary/20 glow-border"
            >
              <Button variant="ghost" size="icon" className="absolute top-4 right-4 opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive" onClick={() => deleteAffirmation({id: a.id}, {onSuccess: () => refetch()})}>
                <Trash2 className="w-4 h-4" />
              </Button>
              <Quote className="w-8 h-8 text-primary/40 mb-4" />
              <p className="font-display text-2xl leading-relaxed text-foreground/90 italic">"{a.text}"</p>
            </motion.div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}

import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useGetQuotes, useCreateQuote, useDeleteQuote } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Music, Quote, Plus, Trash2, Heart } from "lucide-react";
import { motion } from "framer-motion";

export default function Quotes() {
  const { data: quotes, refetch } = useGetQuotes();
  const { mutate: createQuote, isPending } = useCreateQuote();
  const { mutate: deleteQuote } = useDeleteQuote();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [activeType, setActiveType] = useState<"all" | "quote" | "song">("all");

  const [formData, setFormData] = useState({
    text: "", author: "", type: "quote" as "quote" | "song", source: "", isFavoriteOfChild: false
  });

  const filtered = quotes?.filter(q => activeType === "all" || q.type === activeType);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createQuote({ data: formData }, {
      onSuccess: () => {
        toast({ title: formData.type === "quote" ? "Quote saved" : "Song saved" });
        setIsOpen(false);
        setFormData({ text: "", author: "", type: "quote", source: "", isFavoriteOfChild: false });
        refetch();
      }
    });
  };

  return (
    <PageLayout>
      <PageHeader
        title="Quotes & Songs"
        description="Words and music that carry you through — yours and theirs."
        action={
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground rounded-full px-6 shadow-lg">
                <Plus className="w-4 h-4 mr-2" /> Add
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-white/10 text-foreground sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">Add Quote or Song</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                <div className="flex gap-2">
                  {(["quote", "song"] as const).map(t => (
                    <button key={t} type="button" onClick={() => setFormData({ ...formData, type: t })}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${formData.type === t ? "bg-primary text-primary-foreground" : "bg-white/5 text-muted-foreground hover:bg-white/10"}`}>
                      {t === "quote" ? "Quote" : "Song"}
                    </button>
                  ))}
                </div>
                <textarea value={formData.text} onChange={e => setFormData({ ...formData, text: e.target.value })}
                  placeholder={formData.type === "quote" ? "The quote..." : "Song title or lyrics..."}
                  required className="w-full bg-background border border-white/10 rounded-xl p-3 text-foreground min-h-[120px] resize-none" />
                <Input value={formData.author} onChange={e => setFormData({ ...formData, author: e.target.value })}
                  placeholder={formData.type === "quote" ? "Author (optional)" : "Artist / Band"} className="bg-background border-white/10" />
                <Input value={formData.source} onChange={e => setFormData({ ...formData, source: e.target.value })}
                  placeholder={formData.type === "quote" ? "Source (optional)" : "Album (optional)"} className="bg-background border-white/10" />
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={formData.isFavoriteOfChild} onChange={e => setFormData({ ...formData, isFavoriteOfChild: e.target.checked })} className="rounded" />
                  This was their favorite
                </label>
                <Button type="submit" disabled={isPending} className="w-full bg-primary text-primary-foreground">
                  {isPending ? "Saving..." : "Save"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="flex gap-2 mb-8">
        {(["all", "quote", "song"] as const).map(t => (
          <button key={t} onClick={() => setActiveType(t)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${activeType === t ? "bg-primary text-primary-foreground" : "bg-white/5 text-muted-foreground hover:bg-white/10"}`}>
            {t === "all" ? "All" : t === "quote" ? "Quotes" : "Songs"}
          </button>
        ))}
      </div>

      {!filtered?.length ? (
        <EmptyState icon={Quote} title="Words That Carry You" description="Save the quotes and songs that speak to your heart — about grief, love, and your child." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filtered.map(q => (
            <motion.div key={q.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="glass-panel p-6 rounded-3xl relative group">
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  {q.type === "song" ? <Music className="w-5 h-5 text-primary" /> : <Quote className="w-5 h-5 text-primary" />}
                  {q.isFavoriteOfChild && <Heart className="w-4 h-4 text-rose-400 fill-rose-400" />}
                </div>
                <Button variant="ghost" size="icon" className="opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive hover:bg-destructive/20 transition-all"
                  onClick={() => { if (confirm("Remove?")) deleteQuote({ id: q.id }, { onSuccess: () => refetch() }); }}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-foreground/90 text-lg leading-relaxed italic mb-3">"{q.text}"</p>
              {(q.author || q.source) && (
                <p className="text-primary/70 text-sm">
                  {q.author && `— ${q.author}`}{q.source && ` · ${q.source}`}
                </p>
              )}
              {q.isFavoriteOfChild && <p className="text-rose-400/70 text-xs mt-2">Their favorite</p>}
            </motion.div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}

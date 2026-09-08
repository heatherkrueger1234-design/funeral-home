import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useGetMemories, useCreateMemory, useDeleteMemory } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Image as ImageIcon, Play, Plus, Trash2 } from "lucide-react";
import { ImageField } from "@/components/ui/ImageField";
import { ShareMemoryButton } from "@/components/ShareMemoryButton";
import { motion } from "framer-motion";
import { Slideshow } from "@/components/Slideshow";

export default function Memories() {
  const { data: memories, refetch } = useGetMemories();
  const { mutate: createMemory, isPending } = useCreateMemory();
  const { mutate: deleteMemory } = useDeleteMemory();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [slideshowFrom, setSlideshowFrom] = useState<number | null>(null);

  // Only the ones with a photograph. A memory with no picture is a written
  // note, and a full-screen frame of empty grey is not what anyone opened
  // this for.
  const withPhotos = (memories ?? []).filter(
    (m): m is typeof m & { imageUrl: string } => Boolean(m.imageUrl),
  );

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    imageUrl: "",
    dateTaken: "",
    isAiGenerated: false
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMemory({ data: formData }, {
      onSuccess: () => {
        toast({ title: "Memory added", description: "Safely tucked away." });
        setIsOpen(false);
        setFormData({ title: "", description: "", imageUrl: "", dateTaken: "", isAiGenerated: false });
        refetch();
      }
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to remove this memory?")) {
      deleteMemory({ id }, {
        onSuccess: () => {
          toast({ title: "Removed" });
          refetch();
        }
      });
    }
  };

  return (
    <PageLayout>
      <PageHeader 
        title="Memory Wall" 
        description="A gallery of moments, frozen in time."
        action={
          <div className="flex items-center gap-2">
          {withPhotos.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setSlideshowFrom(0)}
              className="rounded-full px-5 border-white/15 bg-white/5 hover:bg-white/10"
            >
              <Play className="w-4 h-4 mr-2" />
              Slideshow
            </Button>
          )}
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground rounded-full px-6 shadow-lg shadow-primary/20">
                <Plus className="w-4 h-4 mr-2" /> Add Memory
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-white/10 text-foreground sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">Add a Memory</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} required className="bg-background border-white/10" />
                </div>
                <ImageField
                  label="Photo (optional)"
                  value={formData.imageUrl}
                  onChange={(imageUrl) => setFormData({ ...formData, imageUrl })}
                />
                <div className="space-y-2">
                  <Label htmlFor="dateTaken">When was this?</Label>
                  <Input
                    id="dateTaken"
                    value={formData.dateTaken}
                    onChange={e => setFormData({...formData, dateTaken: e.target.value})}
                    placeholder="2019-08-14, or summer 2019, or his last birthday"
                    className="bg-background border-white/10"
                  />
                  <p className="text-xs text-muted-foreground">
                    Anything you like. A real date gets written out in full; anything
                    else is shown exactly as you typed it.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Story / Description</Label>
                  <Textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="bg-background border-white/10 resize-none h-24" />
                </div>
                <div className="flex items-center space-x-2 pt-2">
                  <Checkbox id="ai" checked={formData.isAiGenerated} onCheckedChange={(c) => setFormData({...formData, isAiGenerated: c as boolean})} />
                  <Label htmlFor="ai" className="font-normal text-muted-foreground">This is an AI-generated image/edit</Label>
                </div>
                <Button type="submit" disabled={isPending} className="w-full mt-4 bg-primary text-primary-foreground">
                  {isPending ? "Adding..." : "Save Memory"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        }
      />

      {!memories?.length ? (
        <EmptyState 
          icon={ImageIcon}
          title="No memories added yet"
          description="Upload photos, write down little moments, and start building a beautiful wall of memories."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {memories.map((memory) => (
            <motion.div 
              key={memory.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-panel rounded-2xl overflow-hidden group"
            >
              {memory.imageUrl ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSlideshowFrom(withPhotos.findIndex((m) => m.id === memory.id))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSlideshowFrom(withPhotos.findIndex((m) => m.id === memory.id));
                    }
                  }}
                  aria-label={`Open ${memory.title} full screen`}
                  className="aspect-square relative overflow-hidden bg-secondary cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={memory.imageUrl} alt={memory.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  {memory.isAiGenerated && (
                    <span className="absolute bottom-3 right-3 bg-black/60 backdrop-blur text-white text-xs px-2 py-1 rounded-md">
                      AI Edited
                    </span>
                  )}
                </div>
              ) : (
                <div className="aspect-[2/1] bg-secondary/50 flex items-center justify-center border-b border-white/5">
                  <ImageIcon className="w-12 h-12 text-muted-foreground/30" />
                </div>
              )}
              <div className="p-5 relative">
                <div className="absolute top-4 right-4 flex items-center gap-0.5">
                  <ShareMemoryButton memoryId={memory.id} title={memory.title} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive hover:bg-destructive/20 transition-all"
                    onClick={() => handleDelete(memory.id)}
                    aria-label={`Remove ${memory.title}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <h3 className="font-display text-xl mb-2 pr-20">{memory.title}</h3>
                {memory.description && <p className="text-muted-foreground text-sm line-clamp-3">{memory.description}</p>}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {slideshowFrom !== null && (
        <Slideshow
          slides={withPhotos.map((m) => ({
            id: m.id,
            imageUrl: m.imageUrl,
            title: m.title,
            description: m.description,
            dateTaken: m.dateTaken,
          }))}
          startAt={slideshowFrom}
          onClose={() => setSlideshowFrom(null)}
        />
      )}
    </PageLayout>
  );
}

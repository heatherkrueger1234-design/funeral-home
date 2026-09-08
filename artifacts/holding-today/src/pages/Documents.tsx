import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  getDocument,
  useGetDocuments,
  useCreateDocument,
  useDeleteDocument,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Eye, EyeOff, FileText, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/utils";

const categories = ["medical", "legal", "financial", "funeral", "passwords", "autopsy", "other"] as const;

export default function Documents() {
  const { data: documents, refetch } = useGetDocuments();
  const { mutate: createDoc, isPending } = useCreateDocument();
  const { mutate: deleteDoc } = useDeleteDocument();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  // Revealed bodies are held here rather than in the list query, so they are
  // dropped the moment the page unmounts and never sit in the query cache.
  const [revealed, setRevealed] = useState<Record<number, string | null>>({});
  const [revealing, setRevealing] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    title: "",
    category: "medical" as (typeof categories)[number],
    content: "",
    isPrivate: true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createDoc(
      { data: formData },
      {
        onSuccess: () => {
          toast({ title: "Saved", description: "Encrypted before it was stored." });
          setIsOpen(false);
          setFormData({ title: "", category: "medical", content: "", isPrivate: true });
          refetch();
        },
      },
    );
  };

  const handleReveal = async (id: number) => {
    if (id in revealed) {
      setRevealed(({ [id]: _dropped, ...rest }) => rest);
      return;
    }

    setRevealing(id);
    try {
      const doc = await getDocument(id);
      setRevealed((prev) => ({ ...prev, [id]: doc.content ?? null }));
    } catch {
      toast({
        title: "Couldn't open that record",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setRevealing(null);
    }
  };

  return (
    <PageLayout>
      <PageHeader
        title="Important Records"
        description="Medical records, passwords and difficult documents. Encrypted before they're stored, and hidden until you ask for them."
        action={
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground rounded-full px-6 shadow-lg">
                <Plus className="w-4 h-4 mr-2" /> Add Record
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-white/10 text-foreground">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">Add a Record</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    required
                    className="bg-background border-white/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(v) =>
                      setFormData({ ...formData, category: v as (typeof categories)[number] })
                    }
                  >
                    <SelectTrigger className="bg-background border-white/10">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c} className="capitalize">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Notes, passwords, or details</Label>
                  <Textarea
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    className="bg-background border-white/10 resize-none h-28"
                  />
                </div>
                <div className="flex items-start space-x-2 pt-1">
                  <Checkbox
                    id="isPrivate"
                    checked={formData.isPrivate}
                    onCheckedChange={(c) => setFormData({ ...formData, isPrivate: c as boolean })}
                    className="mt-0.5"
                  />
                  <Label htmlFor="isPrivate" className="font-normal text-muted-foreground leading-snug">
                    Keep hidden in the list — the contents won't appear until you
                    choose to show them.
                  </Label>
                </div>
                <Button type="submit" disabled={isPending} className="w-full bg-primary text-primary-foreground">
                  {isPending ? "Saving..." : "Save"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {!documents?.length ? (
        <EmptyState
          icon={Lock}
          title="Safe & Secure"
          description="Keep all important paperwork, passwords, and painful reports organized here."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {documents.map((doc) => {
            const isRevealed = doc.id in revealed;
            const body = doc.contentHidden ? revealed[doc.id] : doc.content;

            return (
              <div key={doc.id} className="glass-panel p-6 rounded-2xl flex items-start gap-4 group">
                <div className="p-3 bg-primary/10 rounded-xl h-fit">
                  <FileText className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2">
                    <h3 className="font-medium text-lg text-foreground break-words">{doc.title}</h3>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive h-8 w-8 flex-shrink-0"
                      onClick={() => deleteDoc({ id: doc.id }, { onSuccess: () => refetch() })}
                      aria-label={`Delete ${doc.title}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-primary/70 uppercase tracking-wider mb-2">{doc.category}</p>

                  {doc.contentUnreadable ? (
                    <p className="text-amber-300/90 text-sm flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>
                        This record can't be opened. Its stored contents don't
                        match the current encryption key, so they may be from a
                        backup taken with a different one.
                      </span>
                    </p>
                  ) : doc.contentHidden ? (
                    <>
                      {isRevealed && (
                        <p className="text-muted-foreground text-sm whitespace-pre-wrap break-words mb-2">
                          {body || <span className="italic opacity-60">No details saved.</span>}
                        </p>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleReveal(doc.id)}
                        disabled={revealing === doc.id}
                        className="h-8 px-2 -ml-2 text-xs text-muted-foreground hover:text-primary"
                      >
                        {revealing === doc.id ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        ) : isRevealed ? (
                          <EyeOff className="w-3.5 h-3.5 mr-1.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5 mr-1.5" />
                        )}
                        {isRevealed ? "Hide" : "Show contents"}
                      </Button>
                    </>
                  ) : (
                    body && (
                      <p className="text-muted-foreground text-sm whitespace-pre-wrap break-words">{body}</p>
                    )
                  )}

                  <p className="text-xs text-muted-foreground mt-2 opacity-50">{formatDate(doc.createdAt)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}

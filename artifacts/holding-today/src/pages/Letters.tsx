import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useGetLetters, useCreateLetter, useDeleteLetter } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Mail, Send, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { motion } from "framer-motion";

type Direction = "to_child" | "from_child" | "received";

export default function Letters() {
  const [tab, setTab] = useState<Direction>("to_child");
  const { data: letters, refetch } = useGetLetters({ direction: tab });
  const { mutate: createLetter, isPending } = useCreateLetter();
  const { mutate: deleteLetter } = useDeleteLetter();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  const [formData, setFormData] = useState({
    title: "",
    content: "",
    letterDate: new Date().toISOString().split('T')[0],
    direction: "to_child" as Direction,
    author: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createLetter({ data: { ...formData, direction: tab } }, {
      onSuccess: () => {
        toast({ title: "Letter saved" });
        setIsOpen(false);
        setFormData({ title: "", content: "", letterDate: new Date().toISOString().split('T')[0], direction: tab, author: "" });
        refetch();
      }
    });
  };

  return (
    <PageLayout>
      <PageHeader 
        title="Letters" 
        description="Words left unspoken, written down forever."
        action={
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground rounded-full px-6 shadow-lg">
                <Send className="w-4 h-4 mr-2" /> Draft Letter
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-white/10 text-foreground sm:max-w-[700px]">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">
                  {tab === "to_child" ? "Write to them" : tab === "from_child" ? "Save a letter from them" : "Save a letter from others"}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                <Input value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} placeholder="Subject / Title" required className="bg-background border-white/10" />
                {tab !== "to_child" && (
                  <Input value={formData.author} onChange={e => setFormData({...formData, author: e.target.value})} placeholder="Author's Name" className="bg-background border-white/10" />
                )}
                <Textarea value={formData.content} onChange={e => setFormData({...formData, content: e.target.value})} placeholder="Dear..." required className="bg-background border-white/10 min-h-[300px] resize-none" />
                <Button type="submit" disabled={isPending} className="w-full mt-4 bg-primary text-primary-foreground">
                  {isPending ? "Saving..." : "Save Letter"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Direction)} className="mb-8">
        <TabsList className="bg-black/20 border border-white/10 p-1 rounded-xl">
          <TabsTrigger value="to_child" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">To My Child</TabsTrigger>
          <TabsTrigger value="from_child" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">From My Child</TabsTrigger>
          <TabsTrigger value="received" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">From Others</TabsTrigger>
        </TabsList>
      </Tabs>

      {!letters?.length ? (
        <EmptyState 
          icon={Mail}
          title="No letters here yet"
          description="Sometimes writing a letter to them can help release the heaviness in your chest."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {letters.map((letter) => (
            <motion.div 
              key={letter.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#fcfaf8] text-[#2c3e50] p-8 md:p-10 rounded-[2rem] shadow-2xl relative group"
              style={{ backgroundImage: 'repeating-linear-gradient(transparent, transparent 31px, #e5e5e5 31px, #e5e5e5 32px)', lineHeight: '32px', backgroundAttachment: 'local' }}
            >
              <Button variant="ghost" size="icon" className="absolute top-4 right-4 opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive hover:bg-destructive/10" onClick={() => deleteLetter({id: letter.id}, {onSuccess: () => refetch()})}>
                <Trash2 className="w-4 h-4" />
              </Button>
              <h3 className="font-display text-2xl mb-1 pt-2">{letter.title}</h3>
              <p className="text-sm text-gray-500 italic mb-6">{formatDate(letter.letterDate || letter.createdAt)} {letter.author && `• By ${letter.author}`}</p>
              <p className="whitespace-pre-wrap font-serif text-lg text-gray-800 leading-[32px]">
                {letter.content}
              </p>
            </motion.div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}

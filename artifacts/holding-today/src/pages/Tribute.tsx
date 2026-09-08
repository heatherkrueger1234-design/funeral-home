import { useState, useEffect } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { useGetTribute, useUpdateTribute } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Feather, Save, MapPin, Home, Calendar, DollarSign, BookOpen, Mic } from "lucide-react";
import { motion } from "framer-motion";

export default function Tribute() {
  const { data: tribute } = useGetTribute();
  const { mutate: updateTribute, isPending } = useUpdateTribute();
  const { toast } = useToast();

  const [form, setForm] = useState({
    obituary: "", eulogy: "", speechNotes: "", funeralDetails: "",
    memorialDetails: "", burialLocation: "", funeralHome: "", funeralDate: "", funeralCost: ""
  });

  useEffect(() => {
    if (tribute) {
      setForm({
        obituary: tribute.obituary ?? "",
        eulogy: tribute.eulogy ?? "",
        speechNotes: tribute.speechNotes ?? "",
        funeralDetails: tribute.funeralDetails ?? "",
        memorialDetails: tribute.memorialDetails ?? "",
        burialLocation: tribute.burialLocation ?? "",
        funeralHome: tribute.funeralHome ?? "",
        funeralDate: tribute.funeralDate ?? "",
        funeralCost: tribute.funeralCost ?? "",
      });
    }
  }, [tribute]);

  const handleSave = () => {
    updateTribute({ data: form }, {
      onSuccess: () => toast({ title: "Tribute saved" })
    });
  };

  const field = (label: string, key: keyof typeof form, icon: React.ElementType, placeholder: string, multiline = false, rows = 6) => {
    const Icon = icon;
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-6 rounded-3xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          <h3 className="font-display text-xl text-foreground">{label}</h3>
        </div>
        {multiline ? (
          <Textarea value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}
            placeholder={placeholder} className="bg-background border-white/10 resize-none" rows={rows} />
        ) : (
          <Input value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}
            placeholder={placeholder} className="bg-background border-white/10" />
        )}
      </motion.div>
    );
  };

  return (
    <PageLayout>
      <PageHeader
        title="Tribute & Honors"
        description="Their obituary, your words for the service, and all the details of how you honored them."
        action={
          <Button onClick={handleSave} disabled={isPending} className="bg-primary text-primary-foreground rounded-full px-6 shadow-lg">
            <Save className="w-4 h-4 mr-2" /> {isPending ? "Saving..." : "Save All"}
          </Button>
        }
      />

      <div className="space-y-6">
        <h2 className="text-primary/70 uppercase tracking-widest text-xs font-semibold">Words</h2>
        {field("Obituary", "obituary", Feather, "Write or paste their obituary here...", true, 8)}
        {field("Eulogy / Speech", "eulogy", Mic, "The words you spoke or wanted to speak at their service...", true, 8)}
        {field("Speech Notes", "speechNotes", BookOpen, "Notes, ideas, stories for the service...", true, 5)}

        <h2 className="text-primary/70 uppercase tracking-widest text-xs font-semibold mt-8">Service Details</h2>
        {field("Funeral Home", "funeralHome", Home, "Name of the funeral home")}
        {field("Funeral Date", "funeralDate", Calendar, "Date of the service")}
        {field("Burial / Cremation Location", "burialLocation", MapPin, "Cemetery name, location, or description")}
        {field("Funeral Cost", "funeralCost", DollarSign, "Total cost or itemized breakdown")}
        {field("Funeral Details", "funeralDetails", Feather, "Other details about the funeral arrangements...", true, 4)}

        <h2 className="text-primary/70 uppercase tracking-widest text-xs font-semibold mt-8">Memorial</h2>
        {field("Memorial Details", "memorialDetails", MapPin, "Ongoing memorial, plaque, tree planting, scholarship, charity...", true, 5)}
      </div>
    </PageLayout>
  );
}

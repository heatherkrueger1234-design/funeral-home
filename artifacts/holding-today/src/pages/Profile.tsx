import { useState, useEffect } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { ImageField } from "@/components/ui/ImageField";
import { useGetProfile, useUpdateProfile } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Save } from "lucide-react";

export default function Profile() {
  const { data: profile, isLoading } = useGetProfile();
  const { mutate: updateProfile, isPending } = useUpdateProfile();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    childName: "",
    childBirthDate: "",
    childPassingDate: "",
    childAge: "",
    causeOfDeath: "",
    favoriteColor: "",
    favoriteFood: "",
    favoriteAnimal: "",
    hobbies: "",
    personality: "",
    howTheySmelled: "",
    whatDroveYouCrazy: "",
    lastHugDate: "",
    lastWords: "",
    lastFight: "",
    photoUrl: ""
  });

  useEffect(() => {
    if (profile) {
      setFormData({
        childName: profile.childName || "",
        childBirthDate: profile.childBirthDate || "",
        childPassingDate: profile.childPassingDate || "",
        childAge: profile.childAge || "",
        causeOfDeath: profile.causeOfDeath || "",
        favoriteColor: profile.favoriteColor || "",
        favoriteFood: profile.favoriteFood || "",
        favoriteAnimal: profile.favoriteAnimal || "",
        hobbies: profile.hobbies || "",
        personality: profile.personality || "",
        howTheySmelled: profile.howTheySmelled || "",
        whatDroveYouCrazy: profile.whatDroveYouCrazy || "",
        lastHugDate: profile.lastHugDate || "",
        lastWords: profile.lastWords || "",
        lastFight: profile.lastFight || "",
        photoUrl: profile.photoUrl || ""
      });
    }
  }, [profile]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.childName) {
      toast({ title: "Name required", description: "Please enter your child's name.", variant: "destructive" });
      return;
    }
    updateProfile({ data: formData }, {
      onSuccess: () => {
        toast({ title: "Profile saved", description: "Their details have been gently preserved." });
      }
    });
  };

  if (isLoading) return <PageLayout><div className="animate-pulse flex space-x-4"><div className="flex-1 space-y-6 py-1"><div className="h-2 bg-primary/20 rounded"></div></div></div></PageLayout>;

  return (
    <PageLayout>
      <PageHeader 
        title="Their Profile" 
        description="Preserve the little details that made them who they were."
        action={
          <Button onClick={handleSubmit} disabled={isPending} className="bg-primary text-primary-foreground shadow-lg shadow-primary/20 rounded-full px-6">
            <Save className="w-4 h-4 mr-2" /> {isPending ? "Saving..." : "Save Details"}
          </Button>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-8 max-w-4xl">
        <div className="glass-panel p-8 rounded-3xl space-y-6">
          <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-4">
            <Sparkles className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-display">The Essentials</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Their Beautiful Name *</Label>
              <Input name="childName" value={formData.childName} onChange={handleChange} className="bg-background/50 border-white/10 focus:border-primary" placeholder="Name" required />
            </div>
            <div className="space-y-2">
              <Label>Age</Label>
              <Input name="childAge" value={formData.childAge} onChange={handleChange} className="bg-background/50 border-white/10 focus:border-primary" placeholder="e.g., 7 years old" />
            </div>
            <div className="space-y-2">
              <Label>Birth Date</Label>
              <Input type="date" name="childBirthDate" value={formData.childBirthDate} onChange={handleChange} className="bg-background/50 border-white/10 focus:border-primary" />
            </div>
            <div className="space-y-2">
              <Label>Angel Date (Passing)</Label>
              <Input type="date" name="childPassingDate" value={formData.childPassingDate} onChange={handleChange} className="bg-background/50 border-white/10 focus:border-primary" />
            </div>
            <div className="md:col-span-2">
              <ImageField
                label="Photo"
                value={formData.photoUrl}
                onChange={(photoUrl) => setFormData((prev) => ({ ...prev, photoUrl }))}
                helpText="A picture of them, from this device"
              />
            </div>
          </div>
        </div>

        <div className="glass-panel p-8 rounded-3xl space-y-6">
          <h2 className="text-2xl font-display mb-6 border-b border-white/10 pb-4">The Little Things</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Favorite Color</Label>
              <Input name="favoriteColor" value={formData.favoriteColor} onChange={handleChange} className="bg-background/50" />
            </div>
            <div className="space-y-2">
              <Label>Favorite Food</Label>
              <Input name="favoriteFood" value={formData.favoriteFood} onChange={handleChange} className="bg-background/50" />
            </div>
            <div className="space-y-2">
              <Label>Favorite Animal</Label>
              <Input name="favoriteAnimal" value={formData.favoriteAnimal} onChange={handleChange} className="bg-background/50" />
            </div>
            <div className="space-y-2">
              <Label>Hobbies & Passions</Label>
              <Input name="hobbies" value={formData.hobbies} onChange={handleChange} className="bg-background/50" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>How did they smell?</Label>
              <Textarea name="howTheySmelled" value={formData.howTheySmelled} onChange={handleChange} className="bg-background/50 resize-none" placeholder="e.g., Like strawberries and fresh laundry..." />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>What drove you crazy? (Lovingly)</Label>
              <Textarea name="whatDroveYouCrazy" value={formData.whatDroveYouCrazy} onChange={handleChange} className="bg-background/50 resize-none" placeholder="e.g., Leaving socks everywhere..." />
            </div>
          </div>
        </div>
      </form>
    </PageLayout>
  );
}

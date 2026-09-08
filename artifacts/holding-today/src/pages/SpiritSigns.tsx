import { useEffect, useRef, useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  useGetSigns,
  useCreateSign,
  useDeleteSign,
  type SignKind,
} from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDate } from "@/lib/utils";
import {
  Mic,
  Activity,
  Sparkles,
  Feather,
  Moon,
  Bird,
  Hash,
  Music,
  Wind,
  Plus,
  Star,
  Trash2,
} from "lucide-react";

/** The forms a sign tends to take, in the words people actually use. */
const KINDS: { value: SignKind; label: string; icon: typeof Feather }[] = [
  { value: "cardinal", label: "A bird", icon: Bird },
  { value: "feather", label: "A feather", icon: Feather },
  { value: "number", label: "A number", icon: Hash },
  { value: "song", label: "A song", icon: Music },
  { value: "dream", label: "A dream", icon: Moon },
  { value: "butterfly", label: "A butterfly", icon: Sparkles },
  { value: "scent", label: "A scent", icon: Wind },
  { value: "other", label: "Something else", icon: Star },
];

const kindOf = (value: string) =>
  KINDS.find((k) => k.value === value) ?? KINDS[KINDS.length - 1];

const EMPTY_FORM = {
  what: "",
  story: "",
  kind: "other" as SignKind,
  signDate: "",
  location: "",
  isSignificant: false,
};

export default function SpiritSigns() {
  const { data: signs, refetch } = useGetSigns();
  const { mutate: createSign, isPending } = useCreateSign();
  const { mutate: deleteSign } = useDeleteSign();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Navigating away mid-listen left the timeout to fire against an unmounted
  // component.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleListen = () => {
    setListening(true);
    setMessage("");
    timerRef.current = setTimeout(() => {
      setListening(false);
      const messages = [
        "I am safe. I am happy.",
        "I am always right beside you.",
        "I love you endlessly.",
        "Thank you for everything.",
        "I am in the light now.",
      ];
      setMessage(messages[Math.floor(Math.random() * messages.length)]);
    }, 4000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createSign(
      {
        data: {
          ...form,
          story: form.story || null,
          signDate: form.signDate || null,
          location: form.location || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Kept", description: "Written down before it fades." });
          setIsOpen(false);
          setForm(EMPTY_FORM);
          refetch();
        },
      },
    );
  };

  const handleDelete = (id: number) => {
    if (confirm("Remove this sign?")) {
      deleteSign({ id }, { onSuccess: () => refetch() });
    }
  };

  return (
    <PageLayout>
      <PageHeader
        title="Spirit & Signs"
        description="The cardinal on the fence. The song that came on. Write them down before they blur together."
        action={
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground rounded-full px-6 shadow-lg shadow-primary/20">
                <Plus className="w-4 h-4 mr-2" /> Record a sign
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-white/10 text-foreground sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">
                  What happened?
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>What was it?</Label>
                  <Input
                    value={form.what}
                    onChange={(e) => setForm({ ...form, what: e.target.value })}
                    placeholder="A cardinal on the fence"
                    required
                    className="bg-background border-white/10"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Kind</Label>
                    <Select
                      value={form.kind}
                      onValueChange={(v) =>
                        setForm({ ...form, kind: v as SignKind })
                      }
                    >
                      <SelectTrigger className="bg-background border-white/10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {KINDS.map((k) => (
                          <SelectItem key={k.value} value={k.value}>
                            {k.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>When</Label>
                    <Input
                      type="date"
                      value={form.signDate}
                      onChange={(e) =>
                        setForm({ ...form, signDate: e.target.value })
                      }
                      className="bg-background border-white/10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Where</Label>
                  <Input
                    value={form.location}
                    onChange={(e) =>
                      setForm({ ...form, location: e.target.value })
                    }
                    placeholder="The back garden"
                    className="bg-background border-white/10"
                  />
                </div>

                <div className="space-y-2">
                  <Label>The story (optional)</Label>
                  <Textarea
                    value={form.story}
                    onChange={(e) => setForm({ ...form, story: e.target.value })}
                    placeholder="It sat there the whole time I was on the phone with the funeral home."
                    className="bg-background border-white/10 resize-none h-24"
                  />
                </div>

                <div className="flex items-start space-x-2 pt-1">
                  <Checkbox
                    id="isSignificant"
                    checked={form.isSignificant}
                    onCheckedChange={(c) =>
                      setForm({ ...form, isSignificant: c as boolean })
                    }
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="isSignificant"
                    className="font-normal text-muted-foreground leading-snug"
                  >
                    This one stopped me in my tracks
                  </Label>
                </div>

                <Button
                  type="submit"
                  disabled={isPending}
                  className="w-full mt-2 bg-primary text-primary-foreground"
                >
                  {isPending ? "Keeping..." : "Keep this"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {!signs?.length ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing written down yet"
          description="When something happens that feels like them — a bird, a song, a dream, a number that keeps turning up — put it here. You will not remember them all otherwise, and you will want to."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-14">
          {signs.map((sign) => {
            const kind = kindOf(sign.kind);
            const Icon = kind.icon;

            return (
              <motion.div
                key={sign.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`glass-panel rounded-2xl p-5 flex items-start gap-4 group ${
                  sign.isSignificant ? "border-primary/30 glow-border" : ""
                }`}
              >
                <div className="p-2.5 bg-primary/10 rounded-xl h-fit flex-shrink-0">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2">
                    <h3 className="font-medium text-foreground break-words">
                      {sign.what}
                    </h3>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(sign.id)}
                      aria-label={`Remove ${sign.what}`}
                      className="h-7 w-7 flex-shrink-0 text-destructive opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  {sign.story && (
                    <p className="text-muted-foreground text-sm mt-1.5 whitespace-pre-wrap break-words">
                      {sign.story}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground/60 mt-2">
                    {[
                      sign.signDate ? formatDate(sign.signDate) : null,
                      sign.location,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="glass-panel border-none shadow-none rounded-3xl overflow-hidden">
            <CardContent className="p-8 md:p-10">
              <h2 className="text-3xl font-display mb-6 flex items-center gap-3">
                <Sparkles className="text-primary" /> Signs They Are Near
              </h2>
              <div className="space-y-6 text-lg text-muted-foreground leading-relaxed">
                <p>
                  Many grieving parents report experiencing inexplicable signs
                  shortly after their child passes. These are not coincidences;
                  they are gentle nudges from across the veil.
                </p>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                  <li className="flex gap-3">
                    <Feather className="w-5 h-5 text-primary shrink-0" /> Feathers
                    appearing in unusual places
                  </li>
                  <li className="flex gap-3">
                    <Activity className="w-5 h-5 text-primary shrink-0" />{" "}
                    Flickering lights or electronics turning on
                  </li>
                  <li className="flex gap-3">
                    <Moon className="w-5 h-5 text-primary shrink-0" /> Vivid,
                    hyper-realistic visitation dreams
                  </li>
                  <li className="flex gap-3">
                    <Sparkles className="w-5 h-5 text-primary shrink-0" /> Finding
                    coins, especially pennies or dimes
                  </li>
                </ul>
                <p className="mt-6 pt-6 border-t border-white/10">
                  <strong className="text-foreground font-display">
                    Understanding Energy:
                  </strong>{" "}
                  When a child leaves their physical body, their energy remains.
                  Sometimes, this energy interacts with our physical world,
                  causing what some might call "poltergeist" activity—like toys
                  playing music on their own or doors shifting. Do not fear this;
                  it is simply their vibrant energy saying hello.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="glass-panel border-primary/20 glow-border rounded-3xl h-full relative overflow-hidden text-center flex flex-col items-center justify-center p-8">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />

            <h3 className="text-2xl font-display mb-2 relative z-10">
              A Quiet Moment
            </h3>
            <p className="text-sm text-muted-foreground mb-8 relative z-10">
              Sit for a moment and let a gentle thought come. These are words
              other grieving parents hold on to — not a message, just something
              kind to rest on.
            </p>

            <div className="relative w-32 h-32 mb-8 flex items-center justify-center">
              <AnimatePresence>
                {listening && (
                  <>
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0.1, 0.3] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute inset-0 rounded-full bg-primary/40 blur-xl"
                    />
                    <motion.img
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      src={`${import.meta.env.BASE_URL}images/spirit-light.png`}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover mix-blend-screen"
                    />
                  </>
                )}
              </AnimatePresence>

              <Button
                size="icon"
                onClick={handleListen}
                disabled={listening}
                aria-label="Sit for a quiet moment"
                className={`w-16 h-16 rounded-full relative z-10 shadow-xl transition-all duration-500 ${listening ? "bg-white text-primary shadow-[0_0_30px_rgba(255,255,255,0.8)]" : "bg-primary text-white shadow-[0_0_15px_rgba(14,165,233,0.5)] hover:scale-105"}`}
              >
                <Mic className={`w-8 h-8 ${listening ? "animate-pulse" : ""}`} />
              </Button>
            </div>

            <div className="h-20 flex items-center justify-center w-full relative z-10">
              <AnimatePresence>
                {message && (
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="font-display text-xl text-primary-foreground italic glow-text"
                  >
                    "{message}"
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, FileText, Plus, Trash2 } from "lucide-react";
import {
  useGetObituarys,
  useCreateObituary,
  useUpdateObituary,
  useDeleteObituary,
  type Obituary,
} from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { composeObituary } from "@/lib/obituary";

/**
 * Guided fields on the left, the assembled text on the right.
 *
 * The questions are the ones a funeral home asks, in the order it asks them,
 * so that answering here means arriving with it done rather than composing
 * your child's obituary across a desk from a stranger, on a deadline, being
 * charged by the line.
 *
 * Several drafts per account, because parents write one for the paper, one for
 * the service, and one at four in the morning that says what they actually
 * think — and the last of those must not be overwritten by the first.
 */

type FieldSpec = {
  key: keyof Obituary;
  label: string;
  hint?: string;
  type?: "text" | "date" | "long";
};

const SECTIONS: { heading: string; note?: string; fields: FieldSpec[] }[] = [
  {
    heading: "The facts",
    fields: [
      { key: "fullName", label: "Their full name" },
      { key: "nickname", label: "What everyone actually called them" },
      { key: "bornDate", label: "Born", type: "date" },
      { key: "bornPlace", label: "Born where" },
      { key: "diedDate", label: "Died", type: "date" },
      { key: "diedPlace", label: "Died where" },
    ],
  },
  {
    heading: "Cause of death",
    note: "Optional, and it stays optional. An obituary does not have to name a cause, most do not, and 'died unexpectedly' is a complete sentence. Leave this empty unless you want it in.",
    fields: [
      {
        key: "causeOfDeath",
        label: "If you want it named",
        hint: "after a long illness · unexpectedly at home",
      },
    ],
  },
  {
    heading: "Their family",
    fields: [
      {
        key: "survivedBy",
        label: "Survived by",
        hint: "his mother, his sister, and his grandmother",
        type: "long",
      },
      {
        key: "precededBy",
        label: "Preceded in death by",
        hint: "his grandfather",
        type: "long",
      },
    ],
  },
  {
    heading: "Their life",
    note: "This is the part people actually read, and the part only you can write.",
    fields: [
      {
        key: "lifeDetails",
        label: "School, work, the things they did",
        type: "long",
      },
      {
        key: "personality",
        label: "What they were like",
        hint: "The laugh. The stubbornness. What he was like in a room.",
        type: "long",
      },
      { key: "hobbies", label: "What they loved", type: "long" },
    ],
  },
  {
    heading: "The service",
    fields: [
      {
        key: "serviceDetails",
        label: "Service details",
        hint: "A celebration of his life will be held at… · A private service has been held.",
        type: "long",
      },
      {
        key: "donations",
        label: "In lieu of flowers",
        hint: "donations may be made to…",
        type: "long",
      },
      { key: "additional", label: "Anything else", type: "long" },
    ],
  },
];

function DraftEditor({
  draft,
  onSaved,
}: {
  draft: Obituary;
  onSaved: () => void;
}) {
  const { mutate: update, isPending } = useUpdateObituary();
  const { toast } = useToast();

  const [values, setValues] = useState<Record<string, string>>({});
  const [finalText, setFinalText] = useState("");
  const [editingText, setEditingText] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reloads the form when a different draft is selected.
  useEffect(() => {
    const next: Record<string, string> = { label: draft.label ?? "" };
    for (const section of SECTIONS) {
      for (const field of section.fields) {
        next[field.key] = (draft[field.key] as string | null) ?? "";
      }
    }
    setValues(next);
    setFinalText(draft.finalText ?? "");
    setEditingText(Boolean(draft.finalText));
  }, [draft]);

  const preview = useMemo(() => {
    if (editingText) return finalText;
    return composeObituary({ ...draft, ...values } as Obituary);
  }, [draft, values, editingText, finalText]);

  const save = () => {
    update(
      {
        id: draft.id,
        data: {
          ...Object.fromEntries(
            Object.entries(values).map(([key, value]) => [key, value.trim() || null]),
          ),
          // A blank label would leave an unnameable row in the list.
          label: values.label?.trim() || "Draft",
          finalText: editingText ? finalText.trim() || null : null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Saved" });
          onSaved();
        },
      },
    );
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Couldn't copy that",
        description: "Select the text and copy it by hand.",
        variant: "destructive",
      });
    }
  };

  const download = () => {
    // A blob rather than a server round trip: this is text the browser
    // already has, and it should work without a network.
    const blob = new Blob([preview], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(values.fullName || "obituary").replace(/[^\w -]/g, "")}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const set = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground/70">
            What is this draft
          </Label>
          <Input
            value={values.label ?? ""}
            onChange={(e) => set("label", e.target.value)}
            placeholder="For the paper"
            className="bg-background border-white/10 mt-1.5"
          />
        </div>

        {SECTIONS.map((section) => (
          <div key={section.heading} className="glass-panel rounded-2xl p-5">
            <h3 className="font-display text-lg text-foreground mb-1">
              {section.heading}
            </h3>
            {section.note && (
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                {section.note}
              </p>
            )}
            <div className="space-y-4 mt-4">
              {section.fields.map((field) => (
                <div key={String(field.key)}>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground/70">
                    {field.label}
                  </Label>
                  {field.type === "long" ? (
                    <textarea
                      value={values[field.key] ?? ""}
                      onChange={(e) => set(String(field.key), e.target.value)}
                      placeholder={field.hint}
                      className="w-full bg-background border border-white/10 rounded-xl p-3 text-foreground min-h-[80px] resize-y mt-1.5 text-sm"
                    />
                  ) : (
                    <Input
                      type={field.type === "date" ? "date" : "text"}
                      value={values[field.key] ?? ""}
                      onChange={(e) => set(String(field.key), e.target.value)}
                      placeholder={field.hint}
                      className="bg-background border-white/10 mt-1.5"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start space-y-3">
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h3 className="font-display text-lg text-foreground">
              {editingText ? "Your version" : "Draft"}
            </h3>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={copy}
                className="text-muted-foreground hover:text-foreground"
              >
                {copied ? (
                  <Check className="w-4 h-4 mr-1.5 text-emerald-300" />
                ) : (
                  <Copy className="w-4 h-4 mr-1.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={download}
                className="text-muted-foreground hover:text-foreground"
              >
                <Download className="w-4 h-4 mr-1.5" />
                Save
              </Button>
            </div>
          </div>

          {editingText ? (
            <textarea
              value={finalText}
              onChange={(e) => setFinalText(e.target.value)}
              className="w-full bg-background border border-white/10 rounded-xl p-4 text-foreground/90 min-h-[420px] resize-y leading-relaxed"
            />
          ) : (
            <p className="text-foreground/85 leading-relaxed whitespace-pre-wrap min-h-[200px]">
              {preview || "Fill something in and it will appear here."}
            </p>
          )}

          <div className="mt-4 pt-4 border-t border-white/10">
            {editingText ? (
              <button
                type="button"
                onClick={() => setEditingText(false)}
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                Go back to the fields — this discards your edits to the text
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setFinalText(preview);
                  setEditingText(true);
                }}
                className="text-sm text-primary hover:underline"
              >
                Edit the words directly
              </button>
            )}
          </div>
        </div>

        <Button
          onClick={save}
          disabled={isPending}
          className="w-full bg-primary text-primary-foreground"
        >
          {isPending ? "Saving…" : "Save this draft"}
        </Button>

        <p className="text-sm text-muted-foreground/70 leading-relaxed">
          Nothing here is published anywhere. It is a draft in your account, and
          it stays a draft until you copy it somewhere yourself.
        </p>
      </div>
    </div>
  );
}

export default function ObituaryBuilder() {
  const { data: drafts, refetch } = useGetObituarys();
  const { mutate: create, isPending } = useCreateObituary();
  const { mutate: remove } = useDeleteObituary();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selected =
    drafts?.find((d) => d.id === selectedId) ?? drafts?.[0] ?? null;

  const addDraft = () => {
    create(
      { data: { label: "Draft" } },
      {
        onSuccess: (created) => {
          setSelectedId(created.id);
          refetch();
        },
      },
    );
  };

  return (
    <PageLayout>
      <PageHeader
        title="The obituary"
        description="Answer what you can. Leave the rest. You can come back to it."
        action={
          <Button
            onClick={addDraft}
            disabled={isPending}
            className="bg-primary text-primary-foreground rounded-full px-6"
          >
            <Plus className="w-4 h-4 mr-2" /> New draft
          </Button>
        }
      />

      {!drafts?.length ? (
        <EmptyState
          icon={FileText}
          title="No draft yet"
          description="Start one when you are ready. It asks the same questions the funeral home will ask, so you can answer them here instead of across a desk."
        />
      ) : (
        <>
          {drafts.length > 1 && (
            <div className="flex flex-wrap gap-2 mb-6">
              {drafts.map((draft) => (
                <div key={draft.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setSelectedId(draft.id)}
                    className={cn(
                      "px-4 py-2 rounded-l-full text-sm border transition-colors",
                      selected?.id === draft.id
                        ? "bg-primary/20 border-primary/40 text-primary"
                        : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10",
                    )}
                  >
                    {draft.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm(`Delete "${draft.label}"?`)) return;
                      remove({ id: draft.id }, { onSuccess: () => refetch() });
                    }}
                    aria-label={`Delete ${draft.label}`}
                    className="px-2.5 py-2 rounded-r-full text-sm border border-l-0 border-white/10 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {selected && (
            <DraftEditor
              key={selected.id}
              draft={selected}
              onSaved={() => refetch()}
            />
          )}
        </>
      )}
    </PageLayout>
  );
}

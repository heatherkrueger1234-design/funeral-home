import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilySelections,
  useCreateFamilySelection,
  useDeleteFamilySelection,
  getGetFamilySelectionsQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Lock, Plus, X } from "lucide-react";

/**
 * Hymns, readings, music, and the names of whoever will carry.
 *
 * Four short lists rather than one long form, because they get filled in at
 * different times by different people — the music on the way home from the
 * home, the pallbearers after a phone call round the family.
 *
 * The only rule with teeth: once the funeral home has confirmed an entry it
 * is in the order of service at the printer, so it stops being removable here
 * and the family is told why rather than shown a button that fails.
 */

const SECTIONS = [
  {
    kind: "hymn" as const,
    title: "Hymns",
    placeholder: "The Lord's My Shepherd",
    attribution: null,
  },
  {
    kind: "reading" as const,
    title: "Readings",
    placeholder: "Psalm 23",
    attribution: "Read by",
  },
  {
    kind: "music" as const,
    title: "Music",
    placeholder: "Somewhere Over the Rainbow",
    attribution: "Played when",
  },
  {
    kind: "pallbearer" as const,
    title: "Pallbearers",
    placeholder: "Thomas Hale",
    attribution: "Relationship",
  },
  {
    kind: "eulogist" as const,
    title: "Speaking",
    placeholder: "Anne Hale",
    attribution: "Relationship",
  },
];

export default function Selections() {
  const queryClient = useQueryClient();
  const selections = useGetFamilySelections();
  const [drafts, setDrafts] = useState<Record<string, { value: string; attribution: string }>>(
    {},
  );

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: getGetFamilySelectionsQueryKey(),
    });

  const add = useCreateFamilySelection({ mutation: { onSuccess: refresh } });
  const remove = useDeleteFamilySelection({ mutation: { onSuccess: refresh } });

  if (selections.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const rows = selections.data ?? [];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl mb-1">The service</h1>
        <p className="text-muted-foreground">
          Add what you know. The funeral home will fill in the rest with you.
        </p>
      </header>

      {SECTIONS.map((section) => {
        const items = rows.filter((row) => row.kind === section.kind);
        const draft = drafts[section.kind] ?? { value: "", attribution: "" };

        const submit = () => {
          const value = draft.value.trim();
          if (!value) return;

          add.mutate({
            data: {
              kind: section.kind,
              value,
              attribution: draft.attribution.trim() || null,
            },
          });

          setDrafts((current) => ({
            ...current,
            [section.kind]: { value: "", attribution: "" },
          }));
        };

        return (
          <section key={section.kind} className="space-y-3">
            <h2 className="font-display text-lg">{section.title}</h2>

            {items.length > 0 && (
              <ul className="space-y-2">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.value}</span>
                      {item.attribution && (
                        <span className="block text-sm text-muted-foreground truncate">
                          {item.attribution}
                        </span>
                      )}
                    </span>

                    {item.confirmedAt ? (
                      <span
                        className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                        title="The funeral home has confirmed this one."
                      >
                        <Lock className="size-3.5" />
                        Confirmed
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground"
                        aria-label={`Remove ${item.value}`}
                        onClick={() =>
                          remove.mutate({ selectionId: item.id })
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-2">
              <Input
                value={draft.value}
                placeholder={section.placeholder}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [section.kind]: { ...draft, value: event.target.value },
                  }))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              {section.attribution && (
                <Input
                  value={draft.attribution}
                  placeholder={section.attribution}
                  className="max-w-[9rem]"
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [section.kind]: {
                        ...draft,
                        attribution: event.target.value,
                      },
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submit();
                    }
                  }}
                />
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Add to ${section.title}`}
                disabled={!draft.value.trim()}
                onClick={submit}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

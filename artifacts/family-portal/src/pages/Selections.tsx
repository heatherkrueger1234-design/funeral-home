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
import { Lock, Plus, X } from "lucide-react";
import { Loading, PageHeader } from "@/components/page";

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

  if (selections.isPending) return <Loading rows={4} />;

  const rows = selections.data ?? [];

  return (
    <div className="space-y-8">
      <PageHeader title="The service">
        Add what you know. The funeral home will fill in the rest with you.
      </PageHeader>

      {SECTIONS.map((section) => {
        const items = rows.filter((row) => row.kind === section.kind);
        const draft = drafts[section.kind] ?? { value: "", attribution: "" };

        const submit = () => {
          const value = draft.value.trim();
          if (!value) return;

          add.mutate(
            {
              data: {
                kind: section.kind,
                value,
                attribution: draft.attribution.trim() || null,
              },
            },
            {
              // Cleared at once (so a double tap cannot add it twice), and
              // put back if it did not save — a hymn somebody typed on a
              // bad connection should not simply vanish with the error.
              onError: () =>
                setDrafts((current) =>
                  current[section.kind]?.value
                    ? current
                    : { ...current, [section.kind]: draft },
                ),
            },
          );

          setDrafts((current) => ({
            ...current,
            [section.kind]: { value: "", attribution: "" },
          }));
        };

        return (
          /*
            One card per kind, with its entries and its own "add" line inside
            it. The old shape — a floating heading, then loose rows, then two
            loose boxes — left the eye to guess which input belonged to which
            heading, which on a page with five of them is a guess people get
            wrong.
          */
          <section
            key={section.kind}
            className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--elevation-1)]"
          >
            <h2 className="border-b border-border bg-[var(--sunken)] px-4 py-3 font-display text-base">
              {section.title}
            </h2>

            {items.length > 0 && (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li
                    key={item.id}
                    // A uniform row height. The remove button is a 44px tap
                    // target and the "Confirmed" badge is not, so without this
                    // a confirmed hymn sat in a visibly shorter row than the
                    // one under it.
                    className="flex min-h-14 items-center gap-3 px-4 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {item.value}
                      </span>
                      {item.attribution && (
                        <span className="block truncate text-sm text-muted-foreground">
                          {item.attribution}
                        </span>
                      )}
                    </span>

                    {item.confirmedAt ? (
                      <span
                        className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-deep)]"
                        title="The funeral home has confirmed this one."
                      >
                        <Lock className="size-3" />
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

            {/*
              Three controls on one line is fine on a laptop and cramped on a
              phone, where it squeezed "Somewhere Over the Rainbow" down to
              "Somewhere Ove". Below `sm` the title takes its own row and the
              attribution shares the next one with the button.
            */}
            <div
              className={`flex flex-wrap items-center gap-2 px-4 py-3 ${
                items.length > 0 ? "border-t border-border" : ""
              }`}
            >
              <Input
                value={draft.value}
                // Only the two-field sections need the title on its own row.
                // Hymns has one field, and pushing its "add" button onto a
                // second line for no reason looked like a mistake.
                className={
                  section.attribution
                    ? "min-w-0 flex-1 basis-full sm:basis-0"
                    : "min-w-0 flex-1"
                }
                placeholder={section.placeholder}
                aria-label={`Add to ${section.title.toLowerCase()}`}
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
                  aria-label={`${section.attribution} (optional)`}
                  className="min-w-0 flex-1 basis-0 sm:max-w-[9rem] sm:flex-none"
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
                className="shrink-0"
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

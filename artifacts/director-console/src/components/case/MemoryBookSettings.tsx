import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateMemoryBook,
  useUpdatePhoto,
  getGetMemoryBookQueryKey,
  getGetCasePhotosQueryKey,
  type CasePhoto,
  type MemoryBookUpdate,
  type StaffMemoryBook,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { endOfDay, readYear, toDateInput } from "@/lib/memory-book";

/**
 * The book's own settings: its title, which sections print, the day itself,
 * and when it stops taking contributions.
 *
 * Saved field by field on blur, the way the case's details are. Every
 * section switch defaults on and a section with nothing in it prints
 * nothing, so these are for a home that wants *less* — a plain photograph
 * album, or a words-only booklet — never something a director has to set
 * before the book works.
 */

const SECTIONS: Array<{
  key: keyof Pick<
    StaffMemoryBook,
    | "includeObituary"
    | "includeLifeStory"
    | "includePhotos"
    | "includeCelebration"
    | "includeEulogies"
    | "includeServicePhotos"
  >;
  label: string;
  hint: string;
}> = [
  { key: "includeObituary", label: "The obituary", hint: "After the dedication." },
  { key: "includeLifeStory", label: "Their life", hint: "The chapters, in the order they happened." },
  { key: "includePhotos", label: "Photographs", hint: "The ones chosen for the slideshow." },
  { key: "includeCelebration", label: "The day itself", hint: "When, where, and the order of service." },
  { key: "includeEulogies", label: "What was read", hint: "The eulogies, with the day." },
  { key: "includeServicePhotos", label: "Photographs from the funeral", hint: "At the back." },
];

export function MemoryBookSettings({
  caseId,
  book,
  displayName,
}: {
  caseId: number;
  book: StaffMemoryBook;
  displayName: string;
}) {
  const queryClient = useQueryClient();
  const update = useUpdateMemoryBook({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: getGetMemoryBookQueryKey(caseId) }),
    },
  });

  const save = (data: MemoryBookUpdate) => update.mutate({ caseId, data });

  // The switches answer the click at once rather than waiting for the
  // refetch, which otherwise flicks them back for a beat.
  const [switched, setSwitched] = useState<Partial<Record<string, boolean>>>({});

  /** Save a text field on blur, only when it changed, with blank as null. */
  const text = (field: "title" | "dedication" | "serviceOrder" | "music" | "bearers" | "reception") => ({
    defaultValue: book[field] ?? "",
    onBlur: (event: { target: { value: string } }) => {
      const next = event.target.value.trim() || null;
      if (next === (book[field] ?? null)) return;
      save({ [field]: next });
    },
  });

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
        <h3 className="font-display text-lg">The book</h3>

        <div className="space-y-1.5">
          <Label htmlFor="book-title">Book title</Label>
          <Input id="book-title" placeholder={`Remembering ${displayName}`} maxLength={160} {...text("title")} />
          <p className="text-sm leading-snug text-muted-foreground">
            Left blank, it prints as shown.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="book-dedication">Dedication</Label>
          <Textarea
            id="book-dedication"
            rows={2}
            maxLength={1000}
            placeholder="For Dad, who would have hated the fuss."
            {...text("dedication")}
          />
          <p className="text-sm leading-snug text-muted-foreground">
            In the family's words, if they have some.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="book-closes">Stop taking contributions on</Label>
          <Input
            id="book-closes"
            // Re-mounted when the date changes elsewhere (the close and
            // reopen buttons), since the field is uncontrolled.
            key={book.closesAt ?? "open"}
            type="date"
            className="w-auto"
            defaultValue={toDateInput(book.closesAt)}
            onBlur={(event) => {
              const value = event.target.value;
              const next = value ? endOfDay(value) : null;
              if (value && !next) return;
              if (toDateInput(next) === toDateInput(book.closesAt)) return;
              save({ closesAt: next });
            }}
          />
          <p className="text-sm leading-snug text-muted-foreground">
            Usually left empty. Set it when the book is about to go to the
            printer; the family can still read and print it afterwards.
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
        <h3 className="font-display text-lg">What prints</h3>
        <p className="text-sm leading-snug text-muted-foreground">
          A section with nothing in it prints nothing, so these only need
          turning off for a home that wants less.
        </p>
        <ul className="space-y-3">
          {SECTIONS.map((section) => {
            const id = `book-${section.key}`;
            return (
              <li key={section.key} className="flex items-start gap-3">
                <Switch
                  id={id}
                  checked={switched[section.key] ?? book[section.key]}
                  aria-describedby={`${id}-hint`}
                  onCheckedChange={(checked) => {
                    setSwitched((all) => ({ ...all, [section.key]: checked }));
                    save({ [section.key]: checked });
                  }}
                />
                <div className="min-w-0">
                  <Label htmlFor={id}>{section.label}</Label>
                  <p id={`${id}-hint`} className="text-sm leading-snug text-muted-foreground">
                    {section.hint}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
        <h3 className="font-display text-lg">The day itself</h3>
        <p className="text-sm leading-snug text-muted-foreground">
          When and where come from the case. The rest is what a grandchild
          reading this in thirty years would want to know.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="book-order">Order of service</Label>
          <Textarea id="book-order" rows={4} maxLength={4000} {...text("serviceOrder")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="book-music">Music</Label>
          <Textarea
            id="book-music"
            rows={2}
            maxLength={2000}
            placeholder="Amazing Grace, sung by the grandchildren"
            {...text("music")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="book-bearers">Bearers</Label>
          <Textarea id="book-bearers" rows={2} maxLength={2000} {...text("bearers")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="book-reception">Afterwards</Label>
          <Textarea id="book-reception" rows={2} maxLength={2000} {...text("reception")} />
        </div>
      </section>
    </div>
  );
}

/**
 * The year each chosen photograph was taken, and whether it was taken at the
 * funeral.
 *
 * The family usually knows the year and the home never does, so their page
 * asks too; this is for the director who was told across a desk, and for
 * the funeral's own photographs, which print at the back.
 */
export function PhotoYears({ caseId, photos }: { caseId: number; photos: CasePhoto[] }) {
  const queryClient = useQueryClient();
  const [problems, setProblems] = useState<Record<number, boolean>>({});
  const update = useUpdatePhoto({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: getGetCasePhotosQueryKey(caseId) }),
    },
  });

  const chosen = photos.filter((photo) => photo.selected && photo.status === "visible");

  if (chosen.length === 0) {
    return (
      <p className="text-sm leading-snug text-muted-foreground">
        The photographs chosen for the slideshow go into the book. None are
        chosen yet.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {chosen.map((photo, index) => {
        const id = `photo-year-${photo.id}`;
        return (
          <li key={photo.id} className="flex items-center gap-3">
            <img
              src={`/api/uploads/${photo.uploadId}`}
              alt={photo.caption ?? `Photograph ${index + 1}`}
              loading="lazy"
              className="size-12 shrink-0 rounded-md bg-muted object-cover"
            />
            <div className="min-w-0 flex-1">
              <Label htmlFor={id} className="sr-only">
                Year photograph {index + 1} was taken
              </Label>
              <Input
                id={id}
                className="tabular h-9 w-24"
                inputMode="numeric"
                maxLength={4}
                placeholder="Year"
                defaultValue={photo.takenYear?.toString() ?? ""}
                aria-invalid={problems[photo.id] || undefined}
                aria-describedby={problems[photo.id] ? `${id}-problem` : undefined}
                onBlur={(event) => {
                  const year = readYear(event.target.value);
                  setProblems((all) => ({ ...all, [photo.id]: year === undefined }));
                  if (year === undefined || year === photo.takenYear) return;
                  update.mutate({ photoId: photo.id, data: { takenYear: year } });
                }}
              />
              {problems[photo.id] && (
                <p id={`${id}-problem`} className="mt-1 text-xs text-[var(--destructive)]">
                  A year, like 1974
                </p>
              )}
            </div>
            <label className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                defaultChecked={photo.takenAtService}
                onChange={(event) =>
                  update.mutate({
                    photoId: photo.id,
                    data: { takenAtService: event.target.checked },
                  })
                }
              />
              At the funeral
            </label>
          </li>
        );
      })}
    </ul>
  );
}

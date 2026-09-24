import { useId, useState, type FormEvent } from "react";
import type { CasePhoto } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AuthedImage } from "@/components/AuthedImage";
import { ImagePlus, X } from "lucide-react";
import {
  CHAPTER_TITLE_MAX_LENGTH,
  WHEN_MAX_LENGTH,
  bodyLimit,
  chapterProblem,
  entryProblem,
  parseYear,
  LIFE_CHAPTER_MAX_LENGTH,
  type EntryKind,
} from "@/lib/memory-book";

/**
 * The pieces of the memory book page: the two forms, and the photograph
 * chooser they share.
 *
 * Both forms keep what was typed until the server has said yes. Somebody
 * who has just written three paragraphs about their father and loses them to
 * a dropped connection on a train will not write them a second time — so a
 * failure leaves every word where it was, and only a success clears it.
 */

/** Shown only near the limit, so a short memory is never a form with a meter. */
function Count({ length, limit, id }: { length: number; limit: number; id: string }) {
  if (length < limit * 0.8) return null;

  return (
    <p
      id={id}
      aria-live="polite"
      className={`tabular mt-1.5 text-right text-sm ${
        length > limit ? "font-semibold text-[var(--accent-deep)]" : "text-muted-foreground"
      }`}
    >
      {length.toLocaleString("en-US")} of {limit.toLocaleString("en-US")}
    </p>
  );
}

/**
 * One photograph from the case, or none.
 *
 * A reference to a picture that is already here rather than a second upload,
 * which is what the schema asks for: there is one place photographs of this
 * person live. Collapsed until asked for, because a bin of two hundred
 * thumbnails under every form is a page nobody can scroll on a phone.
 *
 * Native radio buttons underneath, so it is a single tab stop with the arrow
 * keys moving between pictures, and a screen reader hears each caption.
 */
export function PhotoChoice({
  photos,
  value,
  onChange,
}: {
  photos: CasePhoto[];
  value: number | null;
  onChange: (photoId: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const name = useId();
  const chosen = photos.find((photo) => photo.id === value) ?? null;

  if (photos.length === 0) return null;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {chosen && (
          <AuthedImage
            uploadId={chosen.uploadId}
            alt={chosen.caption ?? "The photograph you chose"}
            className="size-14 shrink-0 rounded-lg object-cover"
          />
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <ImagePlus />
          {chosen ? "Choose a different photograph" : "Add a photograph"}
        </Button>
        {chosen && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => onChange(null)}
          >
            Remove it
          </Button>
        )}
      </div>
    );
  }

  return (
    <fieldset className="rounded-xl border border-border bg-[var(--sunken)] p-3">
      <legend className="px-1 text-sm font-semibold">
        Choose one of the photographs already here
      </legend>
      <div className="mt-1 grid max-h-72 grid-cols-3 gap-2 overflow-y-auto p-1 sm:grid-cols-4">
        {photos.map((photo, index) => (
          <label key={photo.id} className="relative cursor-pointer">
            <input
              type="radio"
              name={name}
              className="peer sr-only"
              checked={value === photo.id}
              // Not closed on change: the arrow keys move through a radio
              // group by changing it, and closing on the first press would
              // make the chooser unusable from a keyboard.
              onChange={() => onChange(photo.id)}
            />
            <AuthedImage
              uploadId={photo.uploadId}
              alt={photo.caption ?? `Photograph ${index + 1}`}
              className="aspect-square w-full rounded-lg object-cover ring-offset-2 ring-offset-[var(--sunken)] peer-checked:ring-2 peer-checked:ring-[var(--accent)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)]"
            />
          </label>
        ))}
      </div>
      <div className="mt-2 flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </fieldset>
  );
}

export type EntryValues = {
  kind: EntryKind;
  body: string;
  whenText: string | null;
  photoId: number | null;
};

/**
 * Writing a memory, or changing one.
 *
 * The "when" is a sentence, not a date picker. The schema says why at
 * length: a memory's date is "the summer we had the caravan", and a date
 * picker makes people either invent a day or give up.
 */
export function EntryForm({
  initial,
  photos,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: EntryValues;
  photos: CasePhoto[];
  pending: boolean;
  submitLabel: string;
  onSubmit: (values: EntryValues, reset: () => void) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [kind, setKind] = useState<EntryKind>(initial?.kind ?? "memory");
  const [body, setBody] = useState(initial?.body ?? "");
  const [whenText, setWhenText] = useState(initial?.whenText ?? "");
  const [photoId, setPhotoId] = useState<number | null>(initial?.photoId ?? null);
  const [tried, setTried] = useState(false);

  const problem = entryProblem(kind, body);
  const showProblem = problem !== null && (tried || body.trim().length > bodyLimit(kind));

  const reset = () => {
    setKind("memory");
    setBody("");
    setWhenText("");
    setPhotoId(null);
    setTried(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (problem) return;

    onSubmit(
      {
        kind,
        body: body.trim(),
        whenText: whenText.trim() || null,
        photoId,
      },
      reset,
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <fieldset>
        <legend className="text-sm font-semibold">What is this?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(
            [
              ["memory", "Something I remember"],
              ["eulogy", "What was read at the service"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--accent)]"
            >
              <input
                type="radio"
                name={`${id}-kind`}
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                className="size-4 accent-[var(--accent)]"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <Label htmlFor={`${id}-body`}>
          {kind === "eulogy" ? "The words, as they were read" : "What do you remember?"}
        </Label>
        <p id={`${id}-body-hint`} className="mt-1 text-sm leading-snug text-muted-foreground">
          {kind === "eulogy"
            ? "It will be printed with the day itself, under your name."
            : "A few lines is plenty. It will be printed under your name."}
        </p>
        <Textarea
          id={`${id}-body`}
          className="mt-2"
          rows={kind === "eulogy" ? 10 : 5}
          value={body}
          aria-describedby={`${id}-body-hint${showProblem ? ` ${id}-body-problem` : ""}`}
          aria-invalid={showProblem || undefined}
          onChange={(event) => setBody(event.target.value)}
        />
        <Count length={body.trim().length} limit={bodyLimit(kind)} id={`${id}-count`} />
        {showProblem && (
          <p id={`${id}-body-problem`} className="mt-1.5 text-sm font-medium text-[var(--accent-deep)]">
            {problem}
          </p>
        )}
      </div>

      {kind === "memory" && (
        <div>
          <Label htmlFor={`${id}-when`}>When was this? (if you like)</Label>
          <Input
            id={`${id}-when`}
            className="mt-2"
            value={whenText}
            maxLength={WHEN_MAX_LENGTH}
            placeholder="The summer we rented the lake house"
            onChange={(event) => setWhenText(event.target.value)}
          />
        </div>
      )}

      <PhotoChoice photos={photos} value={photoId} onChange={setPhotoId} />

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export type ChapterValues = {
  title: string | null;
  body: string | null;
  startYear: number | null;
  endYear: number | null;
  photoId: number | null;
};

/**
 * One chapter of a life. Years rather than dates, for the same reason the
 * photographs take a year: a family knows the decade and argues about the
 * month.
 */
export function ChapterForm({
  initial,
  photos,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: ChapterValues;
  photos: CasePhoto[];
  pending: boolean;
  submitLabel: string;
  onSubmit: (values: ChapterValues, reset: () => void) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [start, setStart] = useState(initial?.startYear?.toString() ?? "");
  const [end, setEnd] = useState(initial?.endYear?.toString() ?? "");
  const [photoId, setPhotoId] = useState<number | null>(initial?.photoId ?? null);
  const [problem, setProblem] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setBody("");
    setStart("");
    setEnd("");
    setPhotoId(null);
    setProblem(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const startYear = parseYear(start);
    const endYear = parseYear(end);
    if (!startYear.ok || !endYear.ok) {
      setProblem(!startYear.ok ? startYear.message : (endYear as { message: string }).message);
      return;
    }

    const found = chapterProblem({
      title,
      body,
      startYear: startYear.value,
      endYear: endYear.value,
    });
    setProblem(found);
    if (found) return;

    onSubmit(
      {
        title: title.trim() || null,
        body: body.trim() || null,
        startYear: startYear.value,
        endYear: endYear.value,
        photoId,
      },
      reset,
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <Label htmlFor={`${id}-title`}>What to call it</Label>
        <Input
          id={`${id}-title`}
          className="mt-2"
          value={title}
          maxLength={CHAPTER_TITLE_MAX_LENGTH}
          placeholder="The house on Cedar Street"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${id}-start`}>From (year)</Label>
          <Input
            id={`${id}-start`}
            className="mt-2 tabular"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="1961"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-end`}>Until (if it was a span)</Label>
          <Input
            id={`${id}-end`}
            className="mt-2 tabular"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="1990"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </div>
      </div>
      <p className="-mt-2 text-sm leading-snug text-muted-foreground">
        Chapters are printed in the order of their years, whoever writes them
        and whenever. Leave the years out if nobody is sure.
      </p>

      <div>
        <Label htmlFor={`${id}-body`}>What happened</Label>
        <Textarea
          id={`${id}-body`}
          className="mt-2"
          rows={6}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <Count length={body.trim().length} limit={LIFE_CHAPTER_MAX_LENGTH} id={`${id}-count`} />
      </div>

      <PhotoChoice photos={photos} value={photoId} onChange={setPhotoId} />

      {problem && (
        <p role="alert" className="text-sm font-medium text-[var(--accent-deep)]">
          {problem}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * Taking their own words back out, which is a real delete.
 *
 * Asked once, because it cannot be undone and the button sits next to
 * "Change it" on a small screen.
 */
export function RemoveButton({
  what,
  onConfirm,
}: {
  what: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground">
          <X />
          Take it out
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Take this {what} out of the book?</AlertDialogTitle>
          <AlertDialogDescription>
            It will be gone for good, from here and from the printed book. You
            can always write it again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Take it out</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import { useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMemoryBook,
  useGetCasePhotos,
  useUpdateMemoryBook,
  useCreateMemoryEntry,
  useUpdateMemoryEntry,
  useDeleteMemoryEntry,
  useCreateLifeChapter,
  useUpdateLifeChapter,
  useDeleteLifeChapter,
  getGetMemoryBookQueryKey,
  type CasePhoto,
  type LifeChapter,
  type StaffMemoryEntry,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  ArrowDown,
  ArrowUp,
  BookHeart,
  BookOpen,
  EyeOff,
  Lock,
  Pencil,
  Printer,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import { Divider, Empty, Loading } from "@/components/page";
import { MemoryBookSettings, PhotoYears } from "@/components/case/MemoryBookSettings";
import { formatAtHome } from "@/lib/utils";
import { useHomeZone } from "@/lib/session";
import {
  bookStatus,
  moveWrites,
  readYear,
  sameYear,
  swapWrites,
  yearsLabel,
} from "@/lib/memory-book";

/**
 * The director's side of the memory book.
 *
 * Most of what a home does here is nothing: the family fills it in and the
 * book prints. What this tab is for is the handful of things only the home
 * can do — type up the card that arrived in the post, take out the entry
 * that should not be in a widow's keepsake, put the pages in an order, and
 * close the book on the day it goes to the printer.
 *
 * "Take out" is the ordinary action and "delete" the rare one, the same
 * split the server draws. An entry left out stays on this screen, marked,
 * with the reason; "why is my memory of Mum not in the book" is a question
 * somebody will ask, and the answer has to still be here.
 */

/** The day the book closes, on the home's calendar -- see `formatAtHome`. */
const closingDay = (date: Date, zone: string | undefined) =>
  formatAtHome(date, zone, { day: "numeric", month: "long", year: "numeric" });

const MEMORY_MAX_LENGTH = 4000;
const EULOGY_MAX_LENGTH = 20000;

/** A row's controls: move, leave out or put back, change, delete. */
function RowActions({
  label,
  included,
  canMoveUp,
  canMoveDown,
  onMove,
  onExclude,
  onInclude,
  onEdit,
  onDelete,
}: {
  label: string;
  included: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onExclude: (reason: string | null) => void;
  onInclude: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={`Move ${label} earlier`}
        disabled={!canMoveUp}
        onClick={() => onMove(-1)}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={`Move ${label} later`}
        disabled={!canMoveDown}
        onClick={() => onMove(1)}
      >
        <ArrowDown />
      </Button>

      <Button variant="ghost" size="sm" onClick={onEdit}>
        <Pencil />
        Edit
      </Button>

      {included ? (
        <AlertDialog onOpenChange={(open) => open && setReason("")}>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm">
              <EyeOff />
              Leave out
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave this out of the book?</AlertDialogTitle>
              <AlertDialogDescription>
                It stays here, marked, and can be put back. Whoever wrote it
                still sees it on their own page, with a note that it is not in
                the printed book — never your reason.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="exclude-reason">Why (for the home only)</Label>
              <Textarea
                id="exclude-reason"
                rows={2}
                maxLength={400}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it in</AlertDialogCancel>
              <AlertDialogAction onClick={() => onExclude(reason.trim() || null)}>
                Leave it out
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Button variant="ghost" size="sm" onClick={onInclude}>
          <Undo2 />
          Put back
        </Button>
      )}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label={`Delete ${label}`}
          >
            <Trash2 />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this for good?</AlertDialogTitle>
            <AlertDialogDescription>
              For a duplicate, or something typed onto the wrong case. To keep
              somebody's words out of the book, leave it out instead — that
              keeps a record of it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--destructive)] hover:bg-[var(--destructive)]"
              onClick={onDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Long writing folded after a few lines, with the rest a click away. */
function Words({ text }: { text: string }) {
  const [whole, setWhole] = useState(false);
  const long = text.length > 900;

  return (
    <>
      <p
        className={`whitespace-pre-line text-sm leading-relaxed ${long && !whole ? "line-clamp-[10]" : ""}`}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={whole}
          onClick={() => setWhole((value) => !value)}
          className="mt-1 rounded text-sm font-semibold text-[var(--accent-deep)] underline underline-offset-4"
        >
          {whole ? "Show less" : "Show all of it"}
        </button>
      )}
    </>
  );
}

/** A photograph from the case, by `case_photos.id`, small. */
function Thumb({ photo }: { photo: CasePhoto | null }) {
  if (!photo) return null;
  return (
    <img
      src={`/api/uploads/${photo.uploadId}`}
      alt={photo.caption ?? "Photograph attached to this entry"}
      loading="lazy"
      className="size-16 shrink-0 rounded-md bg-muted object-cover"
    />
  );
}

/** Which photograph, from a plain list — a director knows the captions. */
function PhotoSelect({
  id,
  photos,
  value,
  onChange,
}: {
  id: string;
  photos: CasePhoto[];
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  if (photos.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Photograph (optional)</Label>
      {/* The one native <select> in the app — every other choice field uses
          this component; the plain browser control stood out as the one
          dropdown with no shadow, no matching focus ring and a different
          arrow. "" is reserved by Radix Select for "nothing chosen", hence
          the "none" sentinel rather than an empty string. */}
      <Select
        value={value === null ? "none" : String(value)}
        onValueChange={(next) => onChange(next === "none" ? null : Number(next))}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          {photos.map((photo, index) => (
            <SelectItem key={photo.id} value={String(photo.id)}>
              {photo.caption ? photo.caption : `Photograph ${index + 1}`}
              {photo.uploadedByName ? ` — from ${photo.uploadedByName}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EntryEditor({
  entry,
  photos,
  pending,
  onSave,
  onCancel,
}: {
  entry: StaffMemoryEntry;
  photos: CasePhoto[];
  pending: boolean;
  onSave: (data: { body: string; whenText: string | null; photoId: number | null }) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(entry.body);
  const [whenText, setWhenText] = useState(entry.whenText ?? "");
  const [photoId, setPhotoId] = useState<number | null>(entry.photoId);
  const id = `entry-${entry.id}`;

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) return;
        onSave({ body: body.trim(), whenText: whenText.trim() || null, photoId });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-body`}>Words</Label>
        <Textarea
          id={`${id}-body`}
          rows={6}
          value={body}
          maxLength={EULOGY_MAX_LENGTH}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-when`}>When</Label>
        <Input
          id={`${id}-when`}
          value={whenText}
          maxLength={120}
          onChange={(event) => setWhenText(event.target.value)}
        />
      </div>
      <PhotoSelect id={`${id}-photo`} photos={photos} value={photoId} onChange={setPhotoId} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function LeftOut({ reason }: { reason: string | null | undefined }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 rounded-md bg-[var(--sunken)] px-2.5 py-1.5 text-sm text-muted-foreground">
      <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold text-foreground">Left out of the book.</strong>
        {reason ? ` ${reason}` : ""}
      </span>
    </p>
  );
}

function Card({ children, included }: { children: ReactNode; included: boolean }) {
  return (
    <li
      className={`rounded-xl border bg-card p-4 shadow-[var(--elevation-1)] ${
        included ? "border-border" : "border-dashed border-[var(--border-strong)] bg-[var(--sunken)]"
      }`}
    >
      {children}
    </li>
  );
}

/**
 * Typing up a card, or what was said at the graveside.
 *
 * This is how most of the early entries arrive: the director is the only
 * person who hears and reads all of it. `authorName` is whose memory it is,
 * not who typed it, and it is what prints under the paragraph.
 */
function NewEntryForm({
  caseId,
  photos,
  onDone,
}: {
  caseId: number;
  photos: CasePhoto[];
  onDone: () => void;
}) {
  const [authorName, setAuthorName] = useState("");
  const [kind, setKind] = useState<"memory" | "eulogy">("memory");
  const [body, setBody] = useState("");
  const [whenText, setWhenText] = useState("");
  const [photoId, setPhotoId] = useState<number | null>(null);

  const create = useCreateMemoryEntry({
    mutation: {
      onSuccess: () => {
        setAuthorName("");
        setKind("memory");
        setBody("");
        setWhenText("");
        setPhotoId(null);
        onDone();
      },
    },
  });

  const limit = kind === "eulogy" ? EULOGY_MAX_LENGTH : MEMORY_MAX_LENGTH;
  const tooLong = body.trim().length > limit;
  const ready = authorName.trim() !== "" && body.trim() !== "" && !tooLong;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    create.mutate({
      caseId,
      data: {
        authorName: authorName.trim(),
        kind,
        body: body.trim(),
        whenText: kind === "memory" ? whenText.trim() || null : null,
        photoId,
      },
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
      <h3 className="font-display text-lg">Type up a card</h3>
      <p className="-mt-2 text-sm leading-snug text-muted-foreground">
        Something that came in the post, or was said at the graveside. It
        prints under their name, not yours.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="new-entry-author">Whose words</Label>
        <Input
          id="new-entry-author"
          value={authorName}
          maxLength={120}
          placeholder="Aunt Margaret"
          onChange={(event) => setAuthorName(event.target.value)}
        />
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-semibold">What it is</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {(
            [
              ["memory", "A memory"],
              ["eulogy", "A eulogy or reading"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="new-entry-kind"
                className="size-4 accent-[var(--accent)]"
                checked={kind === value}
                onChange={() => setKind(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="new-entry-body">Words</Label>
        <Textarea
          id="new-entry-body"
          rows={5}
          value={body}
          aria-invalid={tooLong || undefined}
          aria-describedby="new-entry-count"
          onChange={(event) => setBody(event.target.value)}
        />
        <p
          id="new-entry-count"
          className={`tabular text-right text-xs ${tooLong ? "font-semibold text-[var(--destructive)]" : "text-muted-foreground"}`}
        >
          {body.trim().length.toLocaleString()} of {limit.toLocaleString()}
          {tooLong && kind === "memory" ? " — a eulogy can be longer" : ""}
        </p>
      </div>

      {kind === "memory" && (
        <div className="space-y-1.5">
          <Label htmlFor="new-entry-when">When (in their words)</Label>
          <Input
            id="new-entry-when"
            value={whenText}
            maxLength={120}
            placeholder="Every Sunday for about nine years"
            onChange={(event) => setWhenText(event.target.value)}
          />
        </div>
      )}

      <PhotoSelect id="new-entry-photo" photos={photos} value={photoId} onChange={setPhotoId} />

      <Button type="submit" disabled={!ready || create.isPending}>
        {create.isPending ? "Adding…" : "Add to the book"}
      </Button>
    </form>
  );
}

function ChapterEditor({
  chapter,
  photos,
  pending,
  submitLabel,
  withAuthor,
  onSave,
  onCancel,
}: {
  chapter?: LifeChapter;
  photos: CasePhoto[];
  pending: boolean;
  submitLabel: string;
  withAuthor?: boolean;
  onSave: (data: {
    title: string | null;
    body: string | null;
    startYear: number | null;
    endYear: number | null;
    photoId: number | null;
    authorName?: string;
  }, reset: () => void) => void;
  onCancel?: () => void;
}) {
  const id = chapter ? `chapter-${chapter.id}` : "new-chapter";
  const [title, setTitle] = useState(chapter?.title ?? "");
  const [body, setBody] = useState(chapter?.body ?? "");
  const [start, setStart] = useState(chapter?.startYear?.toString() ?? "");
  const [end, setEnd] = useState(chapter?.endYear?.toString() ?? "");
  const [photoId, setPhotoId] = useState<number | null>(chapter?.photoId ?? null);
  const [authorName, setAuthorName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const startYear = readYear(start);
    const endYear = readYear(end);

    if (startYear === undefined || endYear === undefined) {
      setProblem("Years are four digits, like 1974.");
      return;
    }
    if (startYear !== null && endYear !== null && endYear < startYear) {
      setProblem("That chapter ends before it starts.");
      return;
    }
    if (!title.trim() && !body.trim() && startYear === null) {
      setProblem("A chapter needs a title, a year, or something written in it.");
      return;
    }

    setProblem(null);
    onSave({
      title: title.trim() || null,
      body: body.trim() || null,
      startYear,
      endYear,
      photoId,
      ...(withAuthor && authorName.trim() ? { authorName: authorName.trim() } : {}),
    }, () => {
      // Cleared only once the server has it, so a failed save keeps the words.
      setTitle("");
      setBody("");
      setStart("");
      setEnd("");
      setPhotoId(null);
      setAuthorName("");
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-title`}>Title</Label>
        <Input
          id={`${id}-title`}
          value={title}
          maxLength={160}
          placeholder="The Pueblo years"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-start`}>From</Label>
          <Input
            id={`${id}-start`}
            className="tabular"
            inputMode="numeric"
            maxLength={4}
            placeholder="1961"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-end`}>Until</Label>
          <Input
            id={`${id}-end`}
            className="tabular"
            inputMode="numeric"
            maxLength={4}
            placeholder="1990"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-body`}>What happened</Label>
        <Textarea
          id={`${id}-body`}
          rows={4}
          maxLength={6000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
      {withAuthor && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-author`}>Who told you (not printed)</Label>
          <Input
            id={`${id}-author`}
            value={authorName}
            maxLength={120}
            placeholder="Defaults to you"
            onChange={(event) => setAuthorName(event.target.value)}
          />
        </div>
      )}
      <PhotoSelect id={`${id}-photo`} photos={photos} value={photoId} onChange={setPhotoId} />
      {problem && (
        <p role="alert" className="text-sm text-[var(--destructive)]">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function MemoryBookPanel({
  caseId,
  displayName,
}: {
  caseId: number;
  displayName: string;
}) {
  const queryClient = useQueryClient();
  const zone = useHomeZone();
  const book = useGetMemoryBook(caseId);
  const photos = useGetCasePhotos(caseId);
  const [editingEntry, setEditingEntry] = useState<number | null>(null);
  const [editingChapter, setEditingChapter] = useState<number | null>(null);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getGetMemoryBookQueryKey(caseId) });

  const updateBook = useUpdateMemoryBook({ mutation: { onSuccess: refresh } });
  const updateEntry = useUpdateMemoryEntry({ mutation: { onSuccess: refresh } });
  const deleteEntry = useDeleteMemoryEntry({ mutation: { onSuccess: refresh } });
  const createChapter = useCreateLifeChapter({ mutation: { onSuccess: refresh } });
  const updateChapter = useUpdateLifeChapter({ mutation: { onSuccess: refresh } });
  const deleteChapter = useDeleteLifeChapter({ mutation: { onSuccess: refresh } });

  if (book.isPending) return <Loading rows={4} />;

  if (!book.data) {
    return (
      <Empty
        icon={BookHeart}
        title="The memory book couldn't be loaded"
        action={
          <Button variant="outline" size="sm" onClick={() => void book.refetch()}>
            <RotateCcw />
            Try again
          </Button>
        }
      >
        Nothing in it has been lost. This is usually the connection.
      </Empty>
    );
  }

  const data = book.data;
  const visiblePhotos = (photos.data ?? []).filter((photo) => photo.status === "visible");
  const photoById = new Map((photos.data ?? []).map((photo) => [photo.id, photo]));
  const photoFor = (id: number | null) => (id === null ? null : (photoById.get(id) ?? null));

  const eulogies = data.entries.filter((entry) => entry.kind === "eulogy");
  const memories = data.entries.filter((entry) => entry.kind === "memory");
  const leftOut =
    data.entries.filter((entry) => !entry.includedInBook).length +
    data.chapters.filter((chapter) => !chapter.includedInBook).length;
  const overLimit = data.photos.selected > data.photos.limit;

  /*
   * Moves are written for the whole entry list, not the kind shown, because
   * memories and eulogies share one sequence of positions. The swap is made
   * inside the kind's own list and renumbered across all of them.
   */
  const moveEntry = (list: StaffMemoryEntry[], id: number, direction: -1 | 1) => {
    const index = list.findIndex((entry) => entry.id === id);
    const neighbour = list[index + direction];
    if (!neighbour) return;

    for (const write of swapWrites(data.entries, id, neighbour.id)) {
      updateEntry.mutate({ caseId, entryId: write.id, data: { position: write.position } });
    }
  };

  const moveChapter = (id: number, direction: -1 | 1) => {
    for (const write of moveWrites<LifeChapter>(data.chapters, id, direction, sameYear)) {
      updateChapter.mutate({ caseId, chapterId: write.id, data: { position: write.position } });
    }
  };

  const renderEntries = (list: StaffMemoryEntry[], empty: string) =>
    list.length === 0 ? (
      <p className="rounded-lg bg-[var(--sunken)] px-4 py-3 text-sm text-muted-foreground">{empty}</p>
    ) : (
      <ul className="space-y-2.5">
        {list.map((entry, index) => (
          <Card key={entry.id} included={entry.includedInBook}>
            {editingEntry === entry.id ? (
              <EntryEditor
                entry={entry}
                photos={visiblePhotos}
                pending={updateEntry.isPending}
                onCancel={() => setEditingEntry(null)}
                onSave={(values) =>
                  updateEntry.mutate(
                    { caseId, entryId: entry.id, data: values },
                    { onSuccess: () => setEditingEntry(null) },
                  )
                }
              />
            ) : (
              <>
                <div className="flex gap-3">
                  <Thumb photo={photoFor(entry.photoId)} />
                  <div className="min-w-0 flex-1">
                    <Words text={entry.body} />
                    <p className="mt-2 text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground">{entry.authorName}</span>
                      {entry.whenText && ` · ${entry.whenText}`}
                      {entry.authorSide === "staff" && " · typed up here"}
                      {entry.contactNameNow && entry.contactNameNow !== entry.authorName && (
                        <> · now listed as {entry.contactNameNow}</>
                      )}
                    </p>
                    {!entry.includedInBook && <LeftOut reason={entry.excludedReason} />}
                  </div>
                </div>
                <div className="mt-2 border-t border-border pt-2">
                  <RowActions
                    label={`${entry.authorName}'s ${entry.kind === "eulogy" ? "eulogy" : "memory"}`}
                    included={entry.includedInBook}
                    canMoveUp={index > 0}
                    canMoveDown={index < list.length - 1}
                    onMove={(direction) => moveEntry(list, entry.id, direction)}
                    onExclude={(reason) =>
                      updateEntry.mutate({
                        caseId,
                        entryId: entry.id,
                        data: { includedInBook: false, excludedReason: reason },
                      })
                    }
                    onInclude={() =>
                      updateEntry.mutate({ caseId, entryId: entry.id, data: { includedInBook: true } })
                    }
                    onEdit={() => setEditingEntry(entry.id)}
                    onDelete={() => deleteEntry.mutate({ caseId, entryId: entry.id })}
                  />
                </div>
              </>
            )}
          </Card>
        ))}
      </ul>
    );

  return (
    <div className="space-y-6">
      {/*
        The status line and the two things a director comes here to do at the
        end: look at the book, and close it for the printer.
      */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--elevation-1)]">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          {data.open ? (
            <BookOpen className="size-4 shrink-0 text-[var(--accent-deep)]" aria-hidden />
          ) : (
            <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="font-semibold">{bookStatus(data, (date) => closingDay(date, zone))}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          {data.entries.length} {data.entries.length === 1 ? "entry" : "entries"} ·{" "}
          {data.chapters.length} {data.chapters.length === 1 ? "chapter" : "chapters"}
          {leftOut > 0 && ` · ${leftOut} left out`}
        </p>

        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/cases/${caseId}/memory-book/render`} target="_blank" rel="noreferrer">
              <Printer />
              Open the printable book
            </a>
          </Button>

          {data.open ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm">
                  <Lock />
                  Close for printing
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Close the book for printing?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The family can no longer add to it or change what they
                    wrote. They can still read it and print their own copy,
                    and you can reopen it at any time.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Not yet</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      updateBook.mutate({ caseId, data: { closesAt: new Date().toISOString() } })
                    }
                  >
                    Close it
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={updateBook.isPending}
              onClick={() => updateBook.mutate({ caseId, data: { closesAt: null } })}
            >
              <RotateCcw />
              Reopen
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <section className="space-y-3">
            <Divider label="Memories" />
            {renderEntries(
              memories,
              data.open
                ? "None yet. The family can write them from their link, and the check-ins ask for them over the year."
                : "Nobody wrote a memory in this book.",
            )}
          </section>

          <section className="space-y-3">
            <Divider label="Eulogies and readings" />
            {renderEntries(eulogies, "None yet. They print with the day, before the memories.")}
          </section>

          <section className="space-y-3">
            <Divider label="Their life" />
            <p className="text-sm leading-snug text-muted-foreground">
              Chapters print by year. Arrows only move a chapter among others
              from the same year; undated ones go at the end.
            </p>

            {data.chapters.length === 0 ? (
              <p className="rounded-lg bg-[var(--sunken)] px-4 py-3 text-sm text-muted-foreground">
                None yet. What you were told at the arrangement conference is a
                good first chapter.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {data.chapters.map((chapter, index) => {
                  const years = yearsLabel(chapter.startYear, chapter.endYear);
                  const previous = data.chapters[index - 1];
                  const next = data.chapters[index + 1];

                  return (
                    <Card key={chapter.id} included={chapter.includedInBook}>
                      {editingChapter === chapter.id ? (
                        <ChapterEditor
                          chapter={chapter}
                          photos={visiblePhotos}
                          pending={updateChapter.isPending}
                          submitLabel="Save"
                          onCancel={() => setEditingChapter(null)}
                          onSave={(values) =>
                            updateChapter.mutate(
                              { caseId, chapterId: chapter.id, data: values },
                              { onSuccess: () => setEditingChapter(null) },
                            )
                          }
                        />
                      ) : (
                        <>
                          <div className="flex gap-3">
                            <Thumb photo={photoFor(chapter.photoId)} />
                            <div className="min-w-0 flex-1">
                              {years && <p className="eyebrow tabular">{years}</p>}
                              {chapter.title && (
                                <p className="font-display text-base leading-snug">{chapter.title}</p>
                              )}
                              {chapter.body && (
                                <div className="mt-1">
                                  <Words text={chapter.body} />
                                </div>
                              )}
                              <p className="mt-2 text-sm text-muted-foreground">
                                Written by {chapter.authorName}
                                {chapter.authorSide === "staff" ? " (here)" : ""} · not printed
                              </p>
                              {!chapter.includedInBook && <LeftOut reason={null} />}
                            </div>
                          </div>
                          <div className="mt-2 border-t border-border pt-2">
                            <RowActions
                              label={chapter.title ?? (years || "this chapter")}
                              included={chapter.includedInBook}
                              canMoveUp={!!previous && sameYear(previous, chapter)}
                              canMoveDown={!!next && sameYear(next, chapter)}
                              onMove={(direction) => moveChapter(chapter.id, direction)}
                              onExclude={(reason) =>
                                updateChapter.mutate({
                                  caseId,
                                  chapterId: chapter.id,
                                  data: { includedInBook: false, excludedReason: reason },
                                })
                              }
                              onInclude={() =>
                                updateChapter.mutate({
                                  caseId,
                                  chapterId: chapter.id,
                                  data: { includedInBook: true },
                                })
                              }
                              onEdit={() => setEditingChapter(chapter.id)}
                              onDelete={() => deleteChapter.mutate({ caseId, chapterId: chapter.id })}
                            />
                          </div>
                        </>
                      )}
                    </Card>
                  );
                })}
              </ul>
            )}

            <details className="rounded-xl border border-border bg-card p-4 shadow-[var(--elevation-1)]">
              <summary className="cursor-pointer text-sm font-semibold">Add a chapter</summary>
              <div className="mt-3">
                <ChapterEditor
                  photos={visiblePhotos}
                  pending={createChapter.isPending}
                  submitLabel="Add the chapter"
                  withAuthor
                  onSave={(values, reset) =>
                    createChapter.mutate({ caseId, data: values }, { onSuccess: reset })
                  }
                />
              </div>
            </details>
          </section>

          <section className="space-y-3">
            <Divider label="Photographs" />
            <p className={`text-sm ${overLimit ? "font-semibold text-[var(--notice)]" : "text-muted-foreground"}`}>
              {data.photos.selected} chosen · the book carries up to {data.photos.limit}.{" "}
              {overLimit ? "The rest will be left out. " : ""}
              {data.photos.note}
            </p>
            {photos.isPending ? (
              <Loading rows={1} />
            ) : (
              <PhotoYears caseId={caseId} photos={photos.data ?? []} />
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <NewEntryForm caseId={caseId} photos={visiblePhotos} onDone={refresh} />
          <MemoryBookSettings caseId={caseId} book={data} displayName={displayName} />
        </aside>
      </div>
    </div>
  );
}

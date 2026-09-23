import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyMemoryBook,
  useGetFamilyPhotos,
  useGetFamilySession,
  useCreateFamilyMemoryEntry,
  useUpdateFamilyMemoryEntry,
  useDeleteFamilyMemoryEntry,
  useCreateFamilyLifeChapter,
  useUpdateFamilyLifeChapter,
  useDeleteFamilyLifeChapter,
  useUpdateFamilyPhoto,
  useRenderFamilyMemoryBook,
  getGetFamilyMemoryBookQueryKey,
  getGetFamilyPhotosQueryKey,
  getRenderFamilyMemoryBookQueryKey,
  type CasePhoto,
  type FamilyLifeChapter,
  type FamilyMemoryEntry,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { BookOpen, Feather, Lock, Pencil, Plus, Printer } from "lucide-react";
import { Divider, Empty, Loading, PageHeader, Panel } from "@/components/page";
import { AuthedImage } from "@/components/AuthedImage";
import {
  ChapterForm,
  EntryForm,
  RemoveButton,
  type ChapterValues,
  type EntryValues,
} from "@/components/memory-book";
import { isClosedBook, parseYear, yearsLabel } from "@/lib/memory-book";

/**
 * The memory book, from the family's side.
 *
 * This is where the answer goes when a check-in asks whether anything has
 * come back to them — the way she answered the phone, what he was like at
 * Christmas. By the year mark there is a book with the photographs already
 * in it, and this page is how the words get there.
 *
 * Three things are written here: memories, which are signed and belong to
 * whoever wrote them; what was read at the service, which prints with the
 * day; and the life story, a chapter at a time, which is the family's
 * together and is not signed. Everybody can read all of it. Each person can
 * change only their own — the server enforces that, and the page simply
 * does not offer what would be refused.
 *
 * It is free and says nothing about money. `PRICING.md` explains why the
 * book is the one thing this product will never charge a family for.
 */

/**
 * A piece of writing, folded after a few lines when it is long.
 *
 * A eulogy runs to fifteen hundred words, and printed in full it pushes
 * everything under it several phone-screens down. Folded, with the rest one
 * tap away; the book itself always has every word.
 */
function Words({ text }: { text: string }) {
  const [whole, setWhole] = useState(false);
  const long = text.length > 700;

  return (
    <>
      <p
        className={`whitespace-pre-line leading-relaxed ${long && !whole ? "line-clamp-8" : ""}`}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={whole}
          onClick={() => setWhole((value) => !value)}
          className="mt-1.5 rounded text-sm font-semibold text-[var(--accent-deep)] underline decoration-[var(--accent)]/40 underline-offset-4 hover:decoration-[var(--accent)]"
        >
          {whole ? "Show less" : "Read all of it"}
        </button>
      )}
    </>
  );
}

/** "Christmas 1986" under a memory, and the photograph beside it. */
function EntryCard({
  entry,
  photo,
  canChange,
  onEdit,
  onRemove,
}: {
  entry: FamilyMemoryEntry;
  photo: CasePhoto | null;
  canChange: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-xl border border-border bg-card p-4 shadow-[var(--elevation-1)]">
      <article aria-label={`${entry.kind === "eulogy" ? "Read" : "Remembered"} by ${entry.authorName}`}>
        {photo && (
          <AuthedImage
            uploadId={photo.uploadId}
            alt={photo.caption ?? ""}
            className="mb-3 aspect-[4/3] w-full rounded-lg object-cover"
          />
        )}
        <Words text={entry.body} />
        <p className="mt-2.5 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{entry.authorName}</span>
          {entry.whenText && <> · {entry.whenText}</>}
        </p>

        {!entry.includedInBook && (
          /*
           * Only ever on their own entry — the server shows nobody else's
           * exclusions. The home's reason is a note to itself and is never
           * sent; what the family is told is that it is there, that nobody
           * else can see it, and who to ask.
           */
          <p className="mt-3 rounded-lg bg-[var(--sunken)] px-3 py-2 text-sm leading-snug text-muted-foreground">
            The funeral home has kept this one out of the printed book. Only
            you can see it here. Ask them if you would like to know why.
          </p>
        )}

        {entry.mine && (
          <div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-2.5">
            {canChange && (
              <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
                <Pencil />
                Change it
              </Button>
            )}
            <RemoveButton
              what={entry.kind === "eulogy" ? "reading" : "memory"}
              onConfirm={onRemove}
            />
          </div>
        )}
      </article>
    </li>
  );
}

function ChapterCard({
  chapter,
  photo,
  canChange,
  onEdit,
  onRemove,
}: {
  chapter: FamilyLifeChapter;
  photo: CasePhoto | null;
  canChange: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const years = yearsLabel(chapter.startYear, chapter.endYear);

  return (
    <li className="relative border-l-2 border-[var(--accent)]/30 pb-1 pl-5">
      <span
        aria-hidden
        className="absolute -left-[5px] top-1.5 size-2 rounded-full bg-[var(--accent)]"
      />
      {years && <p className="eyebrow tabular mb-1">{years}</p>}
      {chapter.title && (
        <h3 className="font-display text-lg leading-snug">{chapter.title}</h3>
      )}
      {photo && (
        <AuthedImage
          uploadId={photo.uploadId}
          alt={photo.caption ?? ""}
          className="my-2.5 aspect-[4/3] w-full max-w-sm rounded-lg object-cover"
        />
      )}
      {chapter.body && (
        <div className="mt-1">
          <Words text={chapter.body} />
        </div>
      )}

      {!chapter.includedInBook && (
        <p className="mt-2 rounded-lg bg-[var(--sunken)] px-3 py-2 text-sm leading-snug text-muted-foreground">
          The funeral home has kept this chapter out of the printed book. Only
          you can see it here.
        </p>
      )}

      {chapter.mine && (
        <div className="mt-2 flex flex-wrap gap-1">
          {canChange && (
            <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
              <Pencil />
              Change it
            </Button>
          )}
          <RemoveButton what="chapter" onConfirm={onRemove} />
        </div>
      )}
    </li>
  );
}

/**
 * Their own copy, fetched only when asked for.
 *
 * The book is one file with every photograph inside it, and can run to many
 * megabytes. Fetching it on every visit would spend a family's mobile data on
 * a page they only opened to add a sentence, so it waits for the button.
 * Fetched rather than linked for the reason `AuthedImage` gives: the link's
 * credential is a header, and a plain link cannot carry one.
 */
function BookCopy({ version }: { version: number }) {
  const [asked, setAsked] = useState(false);
  const book = useRenderFamilyMemoryBook({
    query: {
      queryKey: [...getRenderFamilyMemoryBookQueryKey(), version],
      enabled: asked,
      staleTime: Infinity,
      retry: 1,
    },
    request: { responseType: "blob" },
  });

  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!book.data) {
      setSrc(null);
      return;
    }
    const url = URL.createObjectURL(book.data);
    setSrc(url);
    return () => {
      URL.revokeObjectURL(url);
      setSrc(null);
    };
  }, [book.data]);

  if (!asked) {
    return (
      <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setAsked(true)}>
        <BookOpen />
        See the book as it stands
      </Button>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="overflow-hidden rounded-xl border border-[var(--border-strong)] bg-white shadow-[var(--elevation-2)]">
        {src ? (
          <iframe title="The memory book" src={src} className="h-[32rem] w-full" />
        ) : (
          <div
            role="status"
            aria-busy={book.isPending || undefined}
            className={`grid h-[32rem] w-full place-items-center bg-[var(--muted)] px-6 text-center text-sm text-muted-foreground ${
              book.isPending ? "animate-pulse" : ""
            }`}
          >
            {book.isError
              ? "The book couldn't be opened just now. Please try again in a little while."
              : "Putting the book together. With the photographs in it, this can take a moment."}
          </div>
        )}
      </div>
      {src && (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent-deep)] decoration-[var(--accent)]/40 underline-offset-4 hover:decoration-[var(--accent)]"
        >
          <Printer className="size-4" />
          Open it full size, to keep or print
        </a>
      )}
    </div>
  );
}

/**
 * The year each chosen photograph was taken.
 *
 * The family are the only people who can answer this — the director has never
 * seen the back of the print — and it is what lets the book run the
 * photographs in the order they were taken, with how old they were under
 * each. A year, never a date: "1974" is what is written on the back.
 */
function PhotoYears({ photos, open }: { photos: CasePhoto[]; open: boolean }) {
  const queryClient = useQueryClient();
  const [shown, setShown] = useState(false);
  const [problems, setProblems] = useState<Record<number, string>>({});

  const update = useUpdateFamilyPhoto({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: getGetFamilyPhotosQueryKey() }),
    },
  });

  const chosen = photos.filter((photo) => photo.selected);

  if (chosen.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        The photographs chosen for the service go into the book. Once some are
        chosen, you can say here roughly when each one was taken.
      </p>
    );
  }

  if (!open) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        The {chosen.length} photographs chosen for the service are in the book.
      </p>
    );
  }

  if (!shown) {
    return (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          The {chosen.length} photographs chosen for the service go into the
          book. If you know roughly when they were taken, the book can show
          them in that order.
        </p>
        <Button type="button" variant="outline" onClick={() => setShown(true)}>
          Add the years
        </Button>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {chosen.map((photo, index) => {
        const inputId = `photo-year-${photo.id}`;
        const problem = problems[photo.id];

        return (
          <li
            key={photo.id}
            className="flex gap-3 rounded-xl border border-border bg-card p-3 shadow-[var(--elevation-1)]"
          >
            <AuthedImage
              uploadId={photo.uploadId}
              alt={photo.caption ?? `Photograph ${index + 1}`}
              className="size-20 shrink-0 rounded-lg object-cover"
            />
            <div className="min-w-0 flex-1">
              <label htmlFor={inputId} className="block text-sm font-semibold">
                Year taken
              </label>
              <Input
                id={inputId}
                className="tabular mt-1.5"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                placeholder="1974"
                disabled={!open}
                defaultValue={photo.takenYear?.toString() ?? ""}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? `${inputId}-problem` : undefined}
                onBlur={(event) => {
                  const parsed = parseYear(event.target.value);
                  if (!parsed.ok) {
                    setProblems((all) => ({ ...all, [photo.id]: parsed.message }));
                    return;
                  }
                  setProblems((all) => {
                    const next = { ...all };
                    delete next[photo.id];
                    return next;
                  });
                  if (parsed.value === photo.takenYear) return;
                  update.mutate({
                    photoId: photo.id,
                    data: { takenYear: parsed.value },
                  });
                }}
              />
              {problem && (
                <p id={`${inputId}-problem`} className="mt-1 text-sm text-[var(--destructive)]">
                  {problem}
                </p>
              )}
              <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  defaultChecked={photo.takenAtService}
                  disabled={!open}
                  onChange={(event) =>
                    update.mutate({
                      photoId: photo.id,
                      data: { takenAtService: event.target.checked },
                    })
                  }
                />
                Taken at the funeral
              </label>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function MemoryBook() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const session = useGetFamilySession();
  const book = useGetFamilyMemoryBook();
  const photos = useGetFamilyPhotos();

  const [editingEntry, setEditingEntry] = useState<number | null>(null);
  const [editingChapter, setEditingChapter] = useState<number | null>(null);
  const [addingChapter, setAddingChapter] = useState(false);
  // Bumped on every change, so a copy opened afterwards is the new one.
  const [version, setVersion] = useState(0);

  const refresh = () => {
    setVersion((value) => value + 1);
    void queryClient.invalidateQueries({ queryKey: getGetFamilyMemoryBookQueryKey() });
  };

  /*
   * A 409 means the home closed the book while this person was typing. The
   * words they wrote are still in the form; re-reading the book is what turns
   * the page into its closed state so they can see why.
   */
  const onError = (error: unknown) => {
    if (isClosedBook(error)) refresh();
  };

  const createEntry = useCreateFamilyMemoryEntry({ mutation: { onError } });
  const updateEntry = useUpdateFamilyMemoryEntry({ mutation: { onError } });
  const deleteEntry = useDeleteFamilyMemoryEntry({ mutation: { onSuccess: refresh } });
  const createChapter = useCreateFamilyLifeChapter({ mutation: { onError } });
  const updateChapter = useUpdateFamilyLifeChapter({ mutation: { onError } });
  const deleteChapter = useDeleteFamilyLifeChapter({ mutation: { onSuccess: refresh } });

  if (book.isPending || session.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="The memory book" />
        <Loading rows={3} />
      </div>
    );
  }

  if (!book.data || !session.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="The memory book" />
        <Empty icon={BookOpen} title="The book couldn't be opened just now">
          Please check your connection and try again. Nothing anybody has
          written has been lost.
        </Empty>
        <div className="text-center">
          <Button type="button" variant="outline" onClick={() => void book.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const data = book.data;
  const open = data.open;
  const name = session.data.case.displayName;
  const allPhotos = photos.data ?? [];
  const photoById = new Map(allPhotos.map((photo) => [photo.id, photo]));
  const photoFor = (id: number | null) => (id === null ? null : (photoById.get(id) ?? null));

  const memories = data.entries.filter((entry) => entry.kind === "memory");
  const eulogies = data.entries.filter((entry) => entry.kind === "eulogy");

  const saveNew = (values: EntryValues, reset: () => void) =>
    createEntry.mutate(
      { data: values },
      {
        onSuccess: () => {
          reset();
          refresh();
          toast({
            title: "Added to the book",
            description: "You can change it or take it out whenever you like.",
          });
        },
      },
    );

  const saveEdit = (entryId: number) => (values: EntryValues) =>
    updateEntry.mutate(
      { entryId, data: values },
      {
        onSuccess: () => {
          setEditingEntry(null);
          refresh();
        },
      },
    );

  const saveChapter = (values: ChapterValues, reset: () => void) =>
    createChapter.mutate(
      { data: values },
      {
        onSuccess: () => {
          reset();
          setAddingChapter(false);
          refresh();
        },
      },
    );

  const saveChapterEdit = (chapterId: number) => (values: ChapterValues) =>
    updateChapter.mutate(
      { chapterId, data: values },
      {
        onSuccess: () => {
          setEditingChapter(null);
          refresh();
        },
      },
    );

  const renderEntries = (rows: FamilyMemoryEntry[]) => (
    <ul className="space-y-3">
      {rows.map((entry) =>
        editingEntry === entry.id ? (
          <li key={entry.id}>
            <Panel>
              <EntryForm
                initial={{
                  kind: entry.kind,
                  body: entry.body,
                  whenText: entry.whenText,
                  photoId: entry.photoId,
                }}
                photos={allPhotos}
                pending={updateEntry.isPending}
                submitLabel="Save the change"
                onSubmit={saveEdit(entry.id)}
                onCancel={() => setEditingEntry(null)}
              />
            </Panel>
          </li>
        ) : (
          <EntryCard
            key={entry.id}
            entry={entry}
            photo={photoFor(entry.photoId)}
            canChange={open}
            onEdit={() => setEditingEntry(entry.id)}
            onRemove={() => deleteEntry.mutate({ entryId: entry.id })}
          />
        ),
      )}
    </ul>
  );

  return (
    <div className="space-y-9">
      <PageHeader title="The memory book">
        {open
          ? `Memories of ${name}, and the story of their life, gathered into a book to keep. Add to it whenever something comes back to you — a few lines is plenty, and there is no hurry.`
          : `Memories of ${name}, and the story of their life, gathered into a book to keep.`}
      </PageHeader>

      {!open && (
        <p
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-border bg-[var(--sunken)] px-4 py-3.5 text-sm leading-relaxed text-muted-foreground"
        >
          <Lock className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          This book has gone to be printed, so nothing more can be added here.
          You can still read it and open your copy. If there is something you
          would still like in it, tell the funeral home.
        </p>
      )}

      <section className="space-y-4">
        <div>
          <Divider label="Memories" />
        </div>

        {open && (
          <Panel>
            <h3 className="mb-4 flex items-center gap-2 font-display text-lg">
              <Feather className="size-5 text-[var(--accent-deep)]" strokeWidth={1.5} aria-hidden />
              Write something down
            </h3>
            <EntryForm
              photos={allPhotos}
              pending={createEntry.isPending}
              submitLabel="Add it to the book"
              onSubmit={saveNew}
            />
          </Panel>
        )}

        {memories.length === 0 ? (
          <Empty icon={Feather} title="No memories yet">
            {open
              ? "The first one is often the hardest. The way they answered the phone, a thing they always said — small things are what people treasure."
              : "Nobody wrote a memory in this book."}
          </Empty>
        ) : (
          renderEntries(memories)
        )}
      </section>

      {eulogies.length > 0 && (
        <section className="space-y-4">
          <div>
            <Divider label="Words from the service" />
          </div>
          {renderEntries(eulogies)}
        </section>
      )}

      <section className="space-y-4">
        <div>
          <Divider label="Their life" />
        </div>
        <p className="text-muted-foreground">
          Where they were born, the houses they lived in, the work they did. Any
          of you can add a chapter, in any order — the book puts them in the
          order they happened.
        </p>

        {data.chapters.length > 0 && (
          <ol className="space-y-6 pt-1">
            {data.chapters.map((chapter) =>
              editingChapter === chapter.id ? (
                <li key={chapter.id}>
                  <Panel>
                    <ChapterForm
                      initial={chapter}
                      photos={allPhotos}
                      pending={updateChapter.isPending}
                      submitLabel="Save the change"
                      onSubmit={saveChapterEdit(chapter.id)}
                      onCancel={() => setEditingChapter(null)}
                    />
                  </Panel>
                </li>
              ) : (
                <ChapterCard
                  key={chapter.id}
                  chapter={chapter}
                  photo={photoFor(chapter.photoId)}
                  canChange={open}
                  onEdit={() => setEditingChapter(chapter.id)}
                  onRemove={() => deleteChapter.mutate({ chapterId: chapter.id })}
                />
              ),
            )}
          </ol>
        )}

        {data.chapters.length === 0 && !addingChapter && (
          <Empty icon={BookOpen} title="No chapters yet">
            {open
              ? "Start anywhere — a year and a line is enough to begin with."
              : "Nobody wrote a chapter of the life story in this book."}
          </Empty>
        )}

        {open &&
          (addingChapter ? (
            <Panel>
              <h3 className="mb-4 font-display text-lg">A new chapter</h3>
              <ChapterForm
                photos={allPhotos}
                pending={createChapter.isPending}
                submitLabel="Add the chapter"
                onSubmit={saveChapter}
                onCancel={() => setAddingChapter(false)}
              />
            </Panel>
          ) : (
            <Button type="button" variant="outline" onClick={() => setAddingChapter(true)}>
              <Plus />
              Add a chapter
            </Button>
          ))}
      </section>

      <section className="space-y-4">
        <div>
          <Divider label="The photographs" />
        </div>
        {photos.isPending ? (
          <Loading rows={1} />
        ) : (
          <PhotoYears photos={allPhotos} open={open} />
        )}
      </section>

      <section className="space-y-4">
        <div>
          <Divider label="Your copy" />
        </div>
        <p className="text-muted-foreground">
          Exactly the book the funeral home will print, with everything in it
          so far. You can keep it, print it at home, or send it to anyone.
        </p>
        <BookCopy version={version} />
      </section>
    </div>
  );
}

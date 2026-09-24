import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyPhotos,
  getFamilyPhotos,
  useGetFamilySession,
  useDeleteFamilyPhoto,
  useUpdateFamilyPhoto,
  useSetFamilyPortrait,
  useSetFamilyReferencePhoto,
  useSetFamilyPhotoSelection,
  getGetFamilyPhotosQueryKey,
  getGetFamilySessionQueryKey,
  postFamilyPhotoMultipart,
  MAX_UPLOAD_BYTES,
  ACCEPTED_UPLOAD_TYPES,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Check,
  Crop,
  Eye,
  Images,
  Loader2,
  Scissors,
  Star,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { Empty, Loading, PageHeader } from "@/components/page";
import { AuthedImage } from "@/components/AuthedImage";
import { voiceFor } from "@/lib/voice";
import { CroppedPhoto, PortraitCropper } from "@/components/Portrait";

/**
 * The photo bin.
 *
 * The thing this screen is competing with is a director's inbox with forty
 * attachments in it from six addresses, so the bar is low and the only job
 * that matters is: make adding pictures from a phone completely trivial, and
 * let the family caption them while they still remember who is in them.
 *
 * Uploads go one at a time even when several are chosen. A phone on mobile
 * data firing twenty parallel requests is how you get half of them failing
 * and a family who believes the whole thing is broken.
 */

/**
 * Send one photograph, waiting out the link's rate limit rather than failing.
 *
 * A family choosing three hundred pictures on good wifi can send them faster
 * than the server's per-minute ceiling allows, and each one past it used to
 * come back as its own red "Couldn't add" — seventy of them, for photographs
 * that were perfectly fine. The server says how long to wait, so wait that
 * long and send the same one again; only a refusal that is about the
 * photograph itself is shown to the family.
 */
async function uploadWithPatience(file: File): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await postFamilyPhotoMultipart(file);
      return;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 429 || attempt >= 4) throw error;

      const header = (error as { headers?: Headers }).headers?.get(
        "retry-after",
      );
      const seconds = Math.min(60, Math.max(1, Number(header) || 10));
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
  }
}

/** Size a caption box to its words: two lines at least, never a scrollbar. */
function fitToText(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight + 2}px`;
}

export default function Photos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const session = useGetFamilySession();
  const photos = useGetFamilyPhotos();

  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(
    null,
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetFamilyPhotosQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetFamilySessionQueryKey() });
  };

  const removePhoto = useDeleteFamilyPhoto({ mutation: { onSuccess: refresh } });
  const updatePhoto = useUpdateFamilyPhoto({ mutation: { onSuccess: refresh } });
  /*
   * Choosing the main photograph leads straight into framing it. The
   * photograph a family chooses is nearly always a snapshot with the person
   * somewhere off to one side, and a card printed from the middle of it is
   * a card of the sideboard; asking now, while they are looking at it, is
   * what stops that reaching the printer.
   */
  const [framing, setFraming] = useState<number | null>(null);
  const setPortrait = useSetFamilyPortrait({ mutation: { onSuccess: refresh } });
  const choosePortrait = (photoId: number) =>
    setPortrait.mutate(
      { data: { photoId } },
      { onSuccess: () => setFraming(photoId) },
    );
  const saveFraming = useSetFamilyPortrait({
    mutation: {
      onSuccess: () => {
        refresh();
        setFraming(null);
        toast({
          title: "Framing kept",
          description: "That's how it will sit on the printed cards.",
        });
      },
    },
  });
  const setReference = useSetFamilyReferencePhoto({
    mutation: { onSuccess: refresh },
  });
  const setSelection = useSetFamilyPhotoSelection({
    mutation: {
      /*
       * The answer is the new list, so it goes straight into the cache.
       *
       * The button below is disabled while a toggle is in flight so the next
       * tap cannot be built from a stale list — but "in flight" used to end
       * when this request returned, and the list it was protecting was only
       * brought up to date by a refetch fired after that. A family picking
       * their fifty in quick succession had a tap land in that gap every few
       * photographs, and each one silently undid the choice before it.
       */
      onSuccess: (data) => {
        queryClient.setQueryData(getGetFamilyPhotosQueryKey(), data);
        void queryClient.invalidateQueries({
          queryKey: getGetFamilySessionQueryKey(),
        });
      },
    },
  });

  const limit = session.data?.photoLimit ?? 1000;
  const target = session.data?.slideshowTarget ?? 50;
  const count = photos.data?.length ?? 0;
  const remaining = Math.max(0, limit - count);

  const chosen = (photos.data ?? []).filter((photo) => photo.selected);
  const portrait = photos.data?.find((photo) => photo.isPortrait) ?? null;
  const framingPhoto = photos.data?.find((photo) => photo.id === framing) ?? null;

  /**
   * Selection is expressed as the whole list, so a tap has to rebuild it.
   * Toggling on appends, which puts a newly chosen photograph at the end of
   * the running order — where somebody adding one more expects it to land.
   *
   * Rebuilt from the server's list as it is now, not from this screen's copy.
   * Brothers and sisters choose from their own phones at the same time; a
   * page opened before a sister picked twenty would otherwise send its
   * older list with the brother's one tap and quietly undo all twenty.
   */
  const [reading, setReading] = useState(false);
  const toggle = async (photoId: number) => {
    setReading(true);
    try {
      const fresh = await queryClient.fetchQuery({
        queryKey: getGetFamilyPhotosQueryKey(),
        queryFn: () => getFamilyPhotos(),
        staleTime: 0,
      });
      const current = fresh
        .filter((photo) => photo.selected)
        .sort((a, b) => a.position - b.position)
        .map((photo) => photo.id);
      const next = current.includes(photoId)
        ? current.filter((id) => id !== photoId)
        : [...current, photoId];
      setSelection.mutate({ data: { photoIds: next } });
    } catch {
      toast({
        title: "That didn't save",
        description: "Please check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setReading(false);
    }
  };

  async function onFilesChosen(files: FileList | null) {
    if (!files?.length) return;

    const chosen = Array.from(files).slice(0, remaining);

    if (chosen.length < files.length) {
      toast({
        title: "That's over the limit",
        description: `There's room for ${remaining} more. The rest weren't added.`,
      });
    }

    setUploading({ done: 0, total: chosen.length });

    for (const [index, file] of chosen.entries()) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast({
          title: `"${file.name}" is too large`,
          description: `Photographs need to be under ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
          variant: "destructive",
        });
        continue;
      }

      try {
        await uploadWithPatience(file);
      } catch (error) {
        toast({
          title: `Couldn't add "${file.name}"`,
          description:
            error instanceof Error ? error.message : "Please try that one again.",
          variant: "destructive",
        });
      }

      setUploading({ done: index + 1, total: chosen.length });
    }

    setUploading(null);
    refresh();
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Photographs">
        Add as many as you like — go through every album if you want to.
        You'll choose the ones for the slideshow afterwards.
      </PageHeader>

      {count > 0 && (
        <div className="rounded-xl border border-border bg-card px-4 py-4 shadow-[var(--elevation-1)]">
          <p className="flex items-center gap-2.5 font-semibold">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-deep)]">
              <Scissors className="size-3.5" />
            </span>
            <span>
              <span className="tabular">{chosen.length}</span> chosen for the
              slideshow
            </span>
          </p>
          {/*
            A rule rather than a percentage. "Around fifty is comfortable" is
            a piece of advice, not a target to hit, and a progress bar that
            fills up would turn choosing photographs of a dead parent into a
            task with a score.
          */}
          <div
            aria-hidden
            className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--muted)]"
          >
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500 ease-[cubic-bezier(0.2,0.6,0.3,1)]"
              style={{
                width: `${Math.min(100, (chosen.length / Math.max(1, target)) * 100)}%`,
              }}
            />
          </div>
          <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
            {chosen.length === 0
              ? `Tap “Slideshow” under the ones you'd like shown. Around ${target} is comfortable to watch.`
              : chosen.length > target
                ? `That's more than the ${target} or so that plays comfortably — it's your choice, and the funeral home will help if you'd like to trim it.`
                : `Around ${target} plays comfortably. Nothing you leave out is deleted.`}
          </p>
        </div>
      )}

      {/*
        The main photograph, as it will be printed. Shown framed, at the
        cards' own proportions, because "which one is the main photograph"
        is only half the question -- the other half is whether the face is
        in the middle of it.
      */}
      {portrait && (
        <section
          aria-labelledby="main-photograph"
          className="flex items-center gap-4 rounded-xl border border-border bg-card p-3.5 shadow-[var(--elevation-1)]"
        >
          <CroppedPhoto
            photo={portrait}
            alt={portrait.caption ?? "The main photograph"}
            className="w-24 shrink-0 rounded-lg ring-1 ring-inset ring-black/5"
          />
          <div className="min-w-0 flex-1">
            <h2 id="main-photograph" className="font-semibold">
              The main photograph
            </h2>
            <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
              For the printed cards and the front of the memory book.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2.5"
              onClick={() => setFraming(portrait.id)}
            >
              <Crop className="size-4" />
              Adjust the framing
            </Button>
          </div>
        </section>
      )}

      <PortraitCropper
        photo={framingPhoto}
        open={framingPhoto !== null}
        onOpenChange={(open) => {
          if (!open) setFraming(null);
        }}
        saving={saveFraming.isPending}
        onSave={(fields) =>
          framingPhoto &&
          saveFraming.mutate({ data: { photoId: framingPhoto.id, ...fields } })
        }
      />

      <div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPTED_UPLOAD_TYPES.join(",")}
          className="sr-only"
          // The visible button below is what people press; this is only
          // reached through it, so it is kept out of the tab order.
          tabIndex={-1}
          aria-label="Choose photographs"
          onChange={(event) => void onFilesChosen(event.target.files)}
        />
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={uploading !== null || remaining === 0}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Adding {uploading.done + 1} of {uploading.total}…
            </>
          ) : (
            <>
              <Upload className="size-4" />
              Choose photographs
            </>
          )}
        </Button>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          {remaining > 0
            ? "You can pick several at once, and come back later for more."
            : "That's as many as we can hold — please ask the funeral home."}
        </p>
      </div>

      {photos.isPending ? (
        <Loading rows={3} />
      ) : photos.isError && !photos.data ? (
        // Not "Nothing here yet": that would tell a family their forty
        // photographs had gone when only the list failed to arrive.
        <Empty
          icon={Images}
          title="The photographs didn't load"
          action={
            <Button type="button" variant="outline" onClick={() => void photos.refetch()}>
              Try again
            </Button>
          }
        >
          Nothing you have added is lost. It is usually the connection.
        </Empty>
      ) : count === 0 ? (
        <Empty icon={Images} title="Nothing here yet">
          Anything you have is welcome — old, blurry, or from someone's camera
          roll. There is no such thing as a photograph that is not good enough.
        </Empty>
      ) : (
        <>
        {/*
          What the three switches under each photograph mean, once, above the
          list. "How they looked" in particular is not a phrase anybody
          guesses the purpose of, and a tooltip does not exist on a phone.
        */}
        <dl className="space-y-1.5 rounded-xl border border-border bg-[var(--sunken)] px-4 py-3.5 text-sm leading-snug text-muted-foreground">
          <div>
            <dt className="inline font-semibold text-foreground">Slideshow</dt>
            <dd className="inline"> — shown at the service.</dd>
          </div>
          <div>
            <dt className="inline font-semibold text-foreground">Main photo</dt>
            <dd className="inline"> — the one on the printed cards. Just one.</dd>
          </div>
          <div>
            <dt className="inline font-semibold text-foreground">How they looked</dt>
            <dd className="inline">
              {voiceFor(session.data?.case.kind).preNeed
                ? " — a recent, clear one of you, so the funeral home knows how you like to look. Just one."
                : " — a recent, clear one, so the funeral home can prepare them as you remember them. Just one."}
            </dd>
          </div>
        </dl>
        <ul className="space-y-3">
          {photos.data!.map((photo) => (
            <li
              key={photo.id}
              className={[
                "overflow-hidden rounded-xl border bg-card transition-gentle",
                "shadow-[var(--elevation-1)]",
                photo.selected
                  ? "border-[var(--accent)]/45 ring-1 ring-inset ring-[var(--accent)]/15"
                  : "border-border",
              ].join(" ")}
            >
              <div className="flex gap-3.5 p-3.5">
                {/*
                  A fixed square with the picture covering it. Camera rolls are
                  a mix of portrait and landscape, and a list that jumps between
                  the two reads as a mess however good the photographs are.
                */}
                <div className="relative size-24 shrink-0">
                  {/* The main photograph is shown as it is framed, so the
                      square here is the middle of what the cards print. */}
                  {photo.isPortrait ? (
                    <CroppedPhoto
                      photo={photo}
                      alt={photo.caption ?? "Photograph"}
                      frameAspect={1}
                      className="size-full rounded-lg ring-1 ring-inset ring-black/5"
                    />
                  ) : (
                    <AuthedImage
                      uploadId={photo.uploadId}
                      alt={photo.caption ?? "Photograph"}
                      className="size-full rounded-lg bg-muted object-cover ring-1 ring-inset ring-black/5"
                    />
                  )}
                  {photo.isPortrait && (
                    <span
                      className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-[var(--accent)] text-white shadow-[var(--elevation-1)] ring-2 ring-card"
                      title="The main photograph"
                    >
                      <Star className="size-3 fill-current" />
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  {/*
                    Two lines rather than one. A caption is "Mum and Dad on
                    the porch at Aspen, the summer before he retired", and a
                    single-line box cut every one of them off at "Mum and Dad
                    on the por", so nobody could read back what they had
                    written without tapping into it.
                  */}
                  <Textarea
                    rows={2}
                    className="min-h-0 resize-none overflow-hidden py-2 leading-snug"
                    // Grows to fit what is written, so the whole caption
                    // is always readable without tapping into it.
                    ref={fitToText}
                    onInput={(event) => fitToText(event.currentTarget)}
                    // Re-drawn when somebody else's caption arrives, so this box
                    // never holds a version older than the one on file.
                    key={photo.caption ?? ""}
                    defaultValue={photo.caption ?? ""}
                    placeholder="Who's in it, and when?"
                    aria-label="Caption: who is in it, and when"
                    onFocus={(event) => {
                      event.currentTarget.dataset.before = event.currentTarget.value;
                    }}
                    // Saved on blur rather than on every keystroke: this is a
                    // phone keyboard on mobile data, and a request per letter
                    // would be both slow and pointless.
                    //
                    // And only when this person actually typed something. Two
                    // relatives captioning the same bin at once used to undo
                    // each other just by tapping through a box: the blur sent
                    // back whatever this screen had loaded, which was the other
                    // person's caption from before they changed it.
                    onBlur={(event) => {
                      const caption = event.target.value.trim();
                      if (event.target.value === event.target.dataset.before) return;
                      if (caption === (photo.caption ?? "")) return;
                      updatePhoto.mutate({
                        photoId: photo.id,
                        data: { caption: caption || null },
                      });
                    }}
                  />

                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm leading-snug text-muted-foreground">
                      {photo.uploadedByName &&
                      photo.uploadedByContactId !== session.data?.contact.id
                        ? `Added by ${photo.uploadedByName}`
                        : null}
                    </p>

                    {/*
                      Only what this person added — see the API's own rule.

                      Up here beside the caption, and set as a quiet link,
                      rather than in the row of choices below. Those three
                      choose what a photograph is *for* and are meant to be
                      tried; this one throws it away. Distance and a plainer
                      voice are the whole of the protection a list like this
                      needs, and more than a confirmation dialog on every tap
                      would be worth.
                    */}
                    {photo.uploadedByContactId === session.data?.contact.id && (
                      <button
                        type="button"
                        className="-mr-1 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm
                                   text-muted-foreground transition-gentle hover:text-[var(--destructive)]"
                        disabled={removePhoto.isPending}
                        onClick={() => removePhoto.mutate({ photoId: photo.id })}
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.75} />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/*
                What this photograph is for: three switches of equal weight,
                ruled across the foot of the card like the columns of a form.
                They used to be a dark pill, a beige pill and a bare word
                wrapping round each other beside the picture — three styles
                for three things of the same kind. Now each is off in the
                same way and on in the same way: the home's colour behind it,
                and its mark set white in a filled circle.
              */}
              <div
                role="group"
                aria-label="What this photograph is for"
                className="grid grid-cols-3 divide-x divide-border border-t border-border bg-[var(--sunken)]"
              >
                <PhotoToggle
                  icon={Check}
                  label="Slideshow"
                  on={photo.selected}
                  // The whole selection list is replaced on every toggle
                  // (see `toggle` above), computed from the last-fetched
                  // list. Tapping a second photo before this one's request
                  // round-trips would build its payload from the same
                  // stale list and silently overwrite this choice, so the
                  // button is disabled until the refetch it triggers lands.
                  disabled={setSelection.isPending || reading}
                  onClick={() => void toggle(photo.id)}
                />
                <PhotoToggle
                  icon={Star}
                  label="Main photo"
                  on={photo.isPortrait}
                  disabled={setPortrait.isPending}
                  // Already the main one: the tap means "let me frame it".
                  onClick={() =>
                    photo.isPortrait
                      ? setFraming(photo.id)
                      : choosePortrait(photo.id)
                  }
                />
                {/*
                  Asked for plainly, because the alternative is the director
                  ringing a daughter to ask how her mother wore her hair.
                */}
                <PhotoToggle
                  icon={Eye}
                  label="How they looked"
                  on={photo.isReference}
                  // One photograph holds this at a time, like the main one,
                  // so tapping the one that already has it changes nothing.
                  onClick={() =>
                    !photo.isReference &&
                    setReference.mutate({ data: { photoId: photo.id } })
                  }
                />
              </div>
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}

/**
 * One of the three switches under a photograph.
 *
 * A real toggle — `aria-pressed` — so a screen reader says "Slideshow,
 * pressed" rather than reading a label that changes under the finger. The
 * label stays put and the state is carried by the fill, which is also what
 * lets all three sit in equal columns at phone width without one of them
 * wrapping to a second line when it turns on.
 */
function PhotoToggle({
  icon: Icon,
  label,
  on,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={[
        "flex min-h-[3.75rem] flex-col items-center justify-center gap-1.5 px-1.5 py-2.5",
        "text-center text-sm font-semibold leading-tight transition-gentle",
        "focus-visible:relative focus-visible:z-10 disabled:opacity-60",
        on
          ? "bg-[var(--accent-soft)] text-[var(--accent-deep)]"
          : "text-muted-foreground hover:bg-card hover:text-foreground",
      ].join(" ")}
    >
      <span
        className={[
          "grid size-6 place-items-center rounded-full transition-gentle",
          on
            ? "bg-[var(--accent)] text-white shadow-[var(--elevation-1)]"
            : "ring-1 ring-inset ring-[var(--border-strong)]",
        ].join(" ")}
      >
        <Icon
          className={on && Icon === Star ? "size-3.5 fill-current" : "size-3.5"}
          strokeWidth={on ? 2.5 : 2}
        />
      </span>
      {label}
    </button>
  );
}

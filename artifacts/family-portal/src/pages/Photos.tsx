import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyPhotos,
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
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Check,
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
  const setPortrait = useSetFamilyPortrait({ mutation: { onSuccess: refresh } });
  const setReference = useSetFamilyReferencePhoto({
    mutation: { onSuccess: refresh },
  });
  const setSelection = useSetFamilyPhotoSelection({
    mutation: { onSuccess: refresh },
  });

  const limit = session.data?.photoLimit ?? 1000;
  const target = session.data?.slideshowTarget ?? 50;
  const count = photos.data?.length ?? 0;
  const remaining = Math.max(0, limit - count);

  const chosen = (photos.data ?? []).filter((photo) => photo.selected);

  /**
   * Selection is expressed as the whole list, so a tap has to rebuild it.
   * Toggling on appends, which puts a newly chosen photograph at the end of
   * the running order — where somebody adding one more expects it to land.
   */
  const toggle = (photoId: number) => {
    const current = chosen.map((photo) => photo.id);
    const next = current.includes(photoId)
      ? current.filter((id) => id !== photoId)
      : [...current, photoId];
    setSelection.mutate({ data: { photoIds: next } });
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
        await postFamilyPhotoMultipart(file);
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

      <div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPTED_UPLOAD_TYPES.join(",")}
          className="sr-only"
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
      ) : count === 0 ? (
        <Empty icon={Images} title="Nothing here yet">
          Anything you have is welcome — old, blurry, or from someone's camera
          roll. There is no such thing as a photograph that is not good enough.
        </Empty>
      ) : (
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
                  <AuthedImage
                    uploadId={photo.uploadId}
                    alt={photo.caption ?? "Photograph"}
                    className="size-full rounded-lg bg-muted object-cover ring-1 ring-inset ring-black/5"
                  />
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
                  <Input
                    defaultValue={photo.caption ?? ""}
                    placeholder="Who's in it, and when?"
                    aria-label="Caption"
                    // Saved on blur rather than on every keystroke: this is a
                    // phone keyboard on mobile data, and a request per letter
                    // would be both slow and pointless.
                    onBlur={(event) => {
                      const caption = event.target.value.trim();
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
                        className="-mr-1 inline-flex shrink-0 items-center gap-1.5 rounded-md px-1 py-1 text-sm
                                   text-muted-foreground transition-gentle hover:text-[var(--destructive)]"
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
                  disabled={setSelection.isPending}
                  onClick={() => toggle(photo.id)}
                />
                <PhotoToggle
                  icon={Star}
                  label="Main photo"
                  on={photo.isPortrait}
                  onClick={() => setPortrait.mutate({ data: { photoId: photo.id } })}
                />
                {/*
                  Asked for plainly, because the alternative is the director
                  ringing a daughter to ask how her mother wore her hair.
                */}
                <PhotoToggle
                  icon={Eye}
                  label="How they looked"
                  on={photo.isReference}
                  onClick={() => setReference.mutate({ data: { photoId: photo.id } })}
                />
              </div>
            </li>
          ))}
        </ul>
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
        "text-center text-[0.8125rem] font-semibold leading-tight transition-gentle",
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

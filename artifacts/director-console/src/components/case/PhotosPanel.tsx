import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCasePhotos,
  useUpdatePhoto,
  useDeletePhoto,
  useUpdateCase,
  useSetPhotoSelection,
  getGetCasePhotosQueryKey,
  getGetCaseQueryKey,
  cropOf,
  postCasePhotoMultipart,
  MAX_UPLOAD_BYTES,
  ACCEPTED_UPLOAD_TYPES,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Check,
  Download,
  Eye,
  EyeOff,
  Images,
  Loader2,
  Scissors,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { Empty, Loading } from "@/components/page";
import { CroppedImg } from "@/components/CroppedImg";

/** A crop that is not simply "the whole photograph". */
function hasFraming(photo: {
  cropX: number | null;
  cropY: number | null;
  cropWidth: number | null;
  cropHeight: number | null;
}): boolean {
  const crop = cropOf(photo);
  return crop !== null && (crop.width < 0.999 || crop.height < 0.999);
}

/**
 * Adding photographs from the office: the print a widow posts in, or the
 * framed picture scanned at the arrangement conference. They go into this
 * case's bin through the same checks as the family's own uploads, one at a
 * time so a failure names the file it was about, and the family sees them
 * marked as added by the home.
 */
function useAddPhotos(caseId: number, onDone: () => void) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  async function onFilesChosen(files: FileList | null) {
    if (!files?.length) return;
    const chosen = Array.from(files);
    setProgress({ done: 0, total: chosen.length });

    for (const [index, file] of chosen.entries()) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast({
          title: `"${file.name}" is too large`,
          description: `Photographs need to be under ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
          variant: "destructive",
        });
      } else {
        try {
          await postCasePhotoMultipart(caseId, file);
        } catch (error) {
          toast({
            title: `Couldn't add "${file.name}"`,
            description:
              error instanceof Error ? error.message : "Please try that one again.",
            variant: "destructive",
          });
        }
      }
      setProgress({ done: index + 1, total: chosen.length });
    }

    setProgress(null);
    onDone();
    if (input.current) input.current.value = "";
  }

  const control = (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPTED_UPLOAD_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => void onFilesChosen(event.target.files)}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={progress !== null}
        onClick={() => input.current?.click()}
      >
        {progress ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Adding {Math.min(progress.done + 1, progress.total)} of {progress.total}…
          </>
        ) : (
          <>
            <Upload className="size-4" aria-hidden />
            Add photographs
          </>
        )}
      </Button>
    </>
  );

  return control;
}

/**
 * The photographs, as the director sees them: including the ones they have
 * hidden, and with the sender's name against each so it is obvious which six
 * came from the daughter and which thirty came from a cousin.
 *
 * Hiding rather than deleting is the default action. A photograph that is
 * too dark to project is still a family's picture of their own mother.
 */
export function PhotosPanel({
  caseId,
  portraitPhotoId,
  referencePhotoId,
}: {
  caseId: number;
  portraitPhotoId: number | null;
  referencePhotoId: number | null;
}) {
  const queryClient = useQueryClient();
  const photos = useGetCasePhotos(caseId);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetCasePhotosQueryKey(caseId),
    });
    void queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
  };

  const update = useUpdatePhoto({ mutation: { onSuccess: refresh } });
  const remove = useDeletePhoto({ mutation: { onSuccess: refresh } });
  const updateCase = useUpdateCase({ mutation: { onSuccess: refresh } });
  const setSelection = useSetPhotoSelection({ mutation: { onSuccess: refresh } });
  const addPhotos = useAddPhotos(caseId, refresh);

  if (photos.isPending) {
    return (
      <Loading />
    );
  }

  const rows = photos.data ?? [];

  if (rows.length === 0) {
    return (
      <Empty icon={Images} title="Nothing in yet" action={addPhotos}>
        The family adds these from their link — go to the Family tab if they
        have not been sent one. Prints posted to the office can be added
        here.
      </Empty>
    );
  }

  const visible = rows.filter((photo) => photo.status === "visible").length;
  const chosen = rows.filter((photo) => photo.selected);

  const toggle = (photoId: number) => {
    const current = chosen.map((photo) => photo.id);
    setSelection.mutate({
      caseId,
      data: {
        photoIds: current.includes(photoId)
          ? current.filter((id) => id !== photoId)
          : [...current, photoId],
      },
    });
  };

  /**
   * The common case is a family who sent thirty and meant all of them, so
   * selecting the lot has to be one click — otherwise the director does
   * thirty taps to express "yes, those".
   */
  const selectAllVisible = () =>
    setSelection.mutate({
      caseId,
      data: {
        photoIds: rows
          .filter((photo) => photo.status === "visible")
          .map((photo) => photo.id),
      },
    });

  return (
    <div className="space-y-4">
      {/*
        The step after collecting is putting them into slideshow software, so
        the download is a plain link rather than a fetch: the browser saves
        the file itself, which keeps a 700 MB pack out of the page's memory.
      */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Scissors className="size-4" />
          <span>
            <strong className="text-foreground">{chosen.length}</strong> chosen
            of {visible} in the bin
            {rows.length - visible > 0
              ? `, ${rows.length - visible} hidden`
              : ""}
          </span>
        </p>

        <div className="ml-auto flex flex-wrap gap-2">
          {addPhotos}
          <Button
            variant="ghost"
            size="sm"
            disabled={setSelection.isPending}
            onClick={selectAllVisible}
          >
            <Check className="size-4" />
            Choose all
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            // The pack is the selection, so offering it empty would only
            // produce an error the director has to interpret.
            className={chosen.length === 0 ? "pointer-events-none opacity-50" : ""}
          >
            {/* pointer-events alone left it reachable by keyboard, where
                Enter downloaded a 400 error as a .zip file. */}
            <a
              href={`/api/cases/${caseId}/photo-pack`}
              download
              aria-disabled={chosen.length === 0}
              tabIndex={chosen.length === 0 ? -1 : undefined}
            >
              <Download className="size-4" />
              Download the pack
            </a>
          </Button>
        </div>
      </div>

    <ul className="grid gap-3 sm:grid-cols-2">
      {rows.map((photo) => {
        const hidden = photo.status === "hidden";

        return (
          <li
            key={photo.id}
            className={`rounded-xl border bg-card p-3 ${
              photo.selected ? "border-[var(--accent)]" : "border-border"
            }`}
          >
            {/*
              The portrait is drawn as it will print: a 4:5 frame through the
              family's crop, set in the same 4:3 space as every other card so
              the grid does not jump.
            */}
            {photo.isPortrait ? (
              <div
                className={`mb-3 flex aspect-[4/3] w-full justify-center rounded-lg bg-muted ${
                  hidden ? "opacity-40" : ""
                }`}
              >
                <CroppedImg
                  photo={photo}
                  alt={photo.caption ?? ""}
                  className="h-full"
                />
              </div>
            ) : (
              <img
                src={`/api/uploads/${photo.uploadId}`}
                alt={photo.caption ?? ""}
                loading="lazy"
                className={`mb-3 aspect-[4/3] w-full rounded-lg object-cover bg-muted ${
                  hidden ? "opacity-40" : ""
                }`}
              />
            )}

            <p className="text-sm">
              {photo.caption || (
                <span className="text-muted-foreground">No caption</span>
              )}
            </p>
            <p className="mb-3 text-sm leading-snug text-muted-foreground">
              {photo.addedByHome
                ? `Added by ${photo.uploadedByName ?? "the home"}`
                : photo.uploadedByName
                  ? `From ${photo.uploadedByName}`
                  : "Added here"}
            </p>

            <div className="flex flex-wrap gap-1">
              <Button
                variant={photo.selected ? "default" : "outline"}
                size="sm"
                aria-pressed={photo.selected}
                onClick={() => toggle(photo.id)}
              >
                <Check className="size-4" />
                {photo.selected ? "Chosen" : "Choose"}
              </Button>

              <Button
                variant={photo.isPortrait ? "secondary" : "ghost"}
                size="sm"
                onClick={() =>
                  updateCase.mutate({
                    caseId,
                    data: { portraitPhotoId: photo.id },
                  })
                }
              >
                <Star
                  className={photo.isPortrait ? "size-4 fill-current" : "size-4"}
                />
                Portrait
              </Button>

              {/*
                The morning-after button replit.md's crop promise exists for:
                the family framed it at midnight, and the face is half off
                the card. The whole photograph is one tap away, because the
                crop was only ever instructions.
              */}
              {photo.isPortrait && hasFraming(photo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    update.mutate({
                      photoId: photo.id,
                      data: { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 },
                    })
                  }
                >
                  Show it whole
                </Button>
              )}

              {/* What the preparation room gets. */}
              <Button
                variant={photo.isReference ? "secondary" : "ghost"}
                size="sm"
                onClick={() =>
                  updateCase.mutate({
                    caseId,
                    data: { referencePhotoId: photo.id },
                  })
                }
              >
                {photo.isReference ? "Reference" : "Use as reference"}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  update.mutate({
                    photoId: photo.id,
                    data: { status: hidden ? "visible" : "hidden" },
                  })
                }
              >
                {hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                {hidden ? "Show" : "Hide"}
              </Button>

              {/*
                The only irreversible button on this card, and it used to be
                an unlabelled bin icon one tap away from Hide: no name for a
                screen reader, and no second chance for anybody. It deletes
                the encrypted bytes, which may be the family's only copy.
              */}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                aria-label={
                  photo.caption
                    ? `Delete the photograph "${photo.caption}" for good`
                    : "Delete this photograph for good"
                }
                title="Delete for good"
                disabled={remove.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete this photograph for good? The family's copy on " +
                        "this page goes too, and it cannot be brought back. " +
                        "Hide keeps it out of the slideshow without losing it.",
                    )
                  ) {
                    remove.mutate({ photoId: photo.id });
                  }
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
    </div>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCasePhotos,
  useUpdatePhoto,
  useDeletePhoto,
  useUpdateCase,
  useSetPhotoSelection,
  getGetCasePhotosQueryKey,
  getGetCaseQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Check, Download, Eye, EyeOff, Images, Scissors, Star, Trash2 } from "lucide-react";
import { Empty, Loading } from "@/components/page";

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

  if (photos.isPending) {
    return (
      <Loading />
    );
  }

  const rows = photos.data ?? [];

  if (rows.length === 0) {
    return (
      <Empty icon={Images} title="Nothing in yet">
        The family adds these from their link — go to the Family tab if they
        have not been sent one.
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

        <div className="ml-auto flex gap-2">
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
            <img
              src={`/api/uploads/${photo.uploadId}`}
              alt={photo.caption ?? ""}
              loading="lazy"
              className={`mb-3 aspect-[4/3] w-full rounded-lg object-cover bg-muted ${
                hidden ? "opacity-40" : ""
              }`}
            />

            <p className="text-sm">
              {photo.caption || (
                <span className="text-muted-foreground">No caption</span>
              )}
            </p>
            <p className="mb-3 text-sm leading-snug text-muted-foreground">
              {photo.uploadedByName
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

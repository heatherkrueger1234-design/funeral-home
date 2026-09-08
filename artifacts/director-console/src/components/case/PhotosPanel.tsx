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
import { Check, Download, Eye, EyeOff, Loader2, Scissors, Star, Trash2 } from "lucide-react";

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
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const rows = photos.data ?? [];

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">
        Nothing in yet. The family adds these from their link.
      </p>
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
            <a href={`/api/cases/${caseId}/photo-pack`} download>
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
            <p className="mb-3 text-xs text-muted-foreground">
              {photo.uploadedByName
                ? `From ${photo.uploadedByName}`
                : "Added here"}
            </p>

            <div className="flex flex-wrap gap-1">
              <Button
                variant={photo.selected ? "default" : "outline"}
                size="sm"
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

              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => remove.mutate({ photoId: photo.id })}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
    </div>
  );
}

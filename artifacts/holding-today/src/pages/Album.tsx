import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Images,
  Loader2,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  getGetAlbumQueryKey,
  useDeleteAlbum,
  useGetAlbum,
  useGetMemories,
  useSetAlbumItems,
  useUpdateAlbum,
} from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Slideshow, formatWhen } from "@/components/Slideshow";
import { MusicField } from "@/components/MusicField";
import { buildPhotoBook } from "@/lib/photo-book";
import { cn } from "@/lib/utils";

/**
 * One album: what is in it, in what order.
 *
 * Reordering is done with up and down buttons rather than by dragging. Drag
 * and drop is nicer to demonstrate and worse to use — it is unreliable on a
 * phone, invisible to a keyboard, and hostile to anyone whose hands are not
 * steady. This is a site people use at four in the morning, so the buttons
 * win.
 *
 * The whole list is saved in one call, so the order on the screen and the
 * order in the database cannot drift apart halfway through.
 */

export default function Album() {
  const [, params] = useRoute("/albums/:id");
  const albumId = Number(params?.id);

  const { data: album, refetch } = useGetAlbum(albumId, {
    query: { queryKey: getGetAlbumQueryKey(albumId), enabled: Number.isFinite(albumId) },
  });
  const { data: allMemories } = useGetMemories();
  const { mutate: setItems, isPending: isSaving } = useSetAlbumItems();
  const { mutate: deleteAlbum } = useDeleteAlbum();
  const { mutate: updateAlbum, isPending: isSavingMusic } = useUpdateAlbum();
  const { toast } = useToast();

  const [order, setOrder] = useState<number[]>([]);
  const [dirty, setDirty] = useState(false);
  const [picking, setPicking] = useState(false);
  const [slideshowFrom, setSlideshowFrom] = useState<number | null>(null);
  const [bookProgress, setBookProgress] = useState<string | null>(null);

  // The saved order is the truth until the person starts rearranging.
  useEffect(() => {
    if (album && !dirty) setOrder(album.photos.map((p) => p.memoryId));
  }, [album, dirty]);

  if (!album) {
    return (
      <PageLayout>
        <p className="text-muted-foreground">Loading…</p>
      </PageLayout>
    );
  }

  const byId = new Map(album.photos.map((p) => [p.memoryId, p]));
  const photos = order.map((id) => byId.get(id)).filter((p) => p !== undefined);
  const candidates = (allMemories ?? []).filter((m) => m.imageUrl);

  const save = (next: number[]) => {
    setItems(
      { id: albumId, data: { memoryIds: next } },
      {
        onSuccess: () => {
          setDirty(false);
          refetch();
        },
      },
    );
  };

  const move = (index: number, delta: number) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setOrder(next);
    setDirty(true);
    save(next);
  };

  const remove = (memoryId: number) => {
    const next = order.filter((id) => id !== memoryId);
    setOrder(next);
    setDirty(true);
    save(next);
  };

  const toggleInAlbum = (memoryId: number) => {
    const next = order.includes(memoryId)
      ? order.filter((id) => id !== memoryId)
      : [...order, memoryId];
    setOrder(next);
    setDirty(true);
    save(next);
  };

  const makeBook = async () => {
    setBookProgress("Starting…");
    try {
      const blob = await buildPhotoBook({
        title: album.title,
        description: album.description,
        photos: photos.map((p) => ({
          imageUrl: p.imageUrl!,
          title: p.title,
          description: p.description,
          dateTaken: p.dateTaken,
        })),
        onProgress: (done, total) => setBookProgress(`Page ${done} of ${total}…`),
      });

      // Handed straight to the browser's own download. Nothing is uploaded
      // anywhere to make the book — it is assembled on this device out of
      // pictures this device already has.
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${album.title.replace(/[^\w\s-]/g, "").trim() || "album"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast({
        title: "Your book is downloading",
        description: "Print it at home, or send the PDF to a photo-book service.",
      });
    } catch (error) {
      toast({
        title: "The book didn't finish",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBookProgress(null);
    }
  };

  return (
    <PageLayout>
      <Link
        href="/albums"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-5"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> All albums
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl md:text-4xl mb-1.5">{album.title}</h1>
          {album.description && (
            <p className="text-muted-foreground max-w-2xl">{album.description}</p>
          )}
          <p className="text-sm text-muted-foreground/70 mt-1">
            {photos.length === 0
              ? "Nothing in it yet"
              : `${photos.length} photograph${photos.length === 1 ? "" : "s"}`}
            {isSaving && " · saving…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {photos.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setSlideshowFrom(0)}
              className="rounded-full px-5 border-white/15 bg-white/5 hover:bg-white/10"
            >
              <Play className="w-4 h-4 mr-2" /> Slideshow
            </Button>
          )}
          {photos.length > 0 && (
            <Button
              variant="outline"
              onClick={makeBook}
              disabled={bookProgress !== null}
              className="rounded-full px-5 border-white/15 bg-white/5 hover:bg-white/10"
            >
              {bookProgress ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <BookOpen className="w-4 h-4 mr-2" />
              )}
              {bookProgress ?? "Make a book"}
            </Button>
          )}
          <Button
            onClick={() => setPicking(true)}
            className="bg-primary text-primary-foreground rounded-full px-5"
          >
            <Plus className="w-4 h-4 mr-2" /> Add photos
          </Button>
        </div>
      </div>

      <div className="mb-6">
        <MusicField
          musicFilename={album.musicFilename}
          isSaving={isSavingMusic}
          onChoose={(uploadId) =>
            updateAlbum(
              { id: albumId, data: { musicUploadId: uploadId } },
              {
                onSuccess: () => {
                  toast({ title: "Music added to this album" });
                  refetch();
                },
              },
            )
          }
          onClear={() =>
            updateAlbum(
              { id: albumId, data: { musicUploadId: null } },
              { onSuccess: () => refetch() },
            )
          }
        />
      </div>

      {photos.length === 0 ? (
        <EmptyState
          icon={Images}
          title="Nothing in this album yet"
          description="Add photographs from the memory wall. They stay on the wall too — an album points at them rather than taking them."
        />
      ) : (
        <ul className="space-y-3">
          {photos.map((photo, index) => (
            <li
              key={photo.memoryId}
              className="glass-panel rounded-xl p-3 flex items-center gap-4"
            >
              <span className="font-mono text-xs text-muted-foreground/50 w-6 text-right tabular-nums">
                {index + 1}
              </span>
              <button
                type="button"
                onClick={() => setSlideshowFrom(index)}
                className="w-20 h-20 rounded-lg overflow-hidden bg-secondary shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                aria-label={`Open ${photo.title} full screen`}
              >
                {photo.imageUrl && (
                  <img src={photo.imageUrl} alt="" className="w-full h-full object-cover" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg truncate">{photo.title}</p>
                {formatWhen(photo.dateTaken) && (
                  <p className="text-xs text-muted-foreground">
                    {formatWhen(photo.dateTaken)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${photo.title} earlier`}
                >
                  <ChevronUp className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => move(index, 1)}
                  disabled={index === photos.length - 1}
                  aria-label={`Move ${photo.title} later`}
                >
                  <ChevronDown className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(photo.memoryId)}
                  aria-label={`Take ${photo.title} out of this album`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 pt-6 border-t border-white/5">
        <Button
          variant="ghost"
          className="text-destructive hover:bg-destructive/10"
          onClick={() => {
            if (
              !confirm(
                `Delete the album "${album.title}"?\n\nThe photographs stay on your memory wall. Only the album is removed.`,
              )
            )
              return;
            deleteAlbum(
              { id: albumId },
              {
                onSuccess: () => {
                  toast({
                    title: "Album deleted",
                    description: "The photographs are still on your memory wall.",
                  });
                  window.location.href = "/albums";
                },
              },
            );
          }}
        >
          <Trash2 className="w-4 h-4 mr-2" /> Delete this album
        </Button>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Deleting an album never deletes a photograph.
        </p>
      </div>

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="bg-card border-white/10 text-foreground sm:max-w-[640px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              Which photographs?
            </DialogTitle>
          </DialogHeader>
          {candidates.length === 0 ? (
            <p className="text-muted-foreground text-sm py-6">
              There are no photographs on the memory wall yet.
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 pt-2">
              {candidates.map((memory) => {
                const inAlbum = order.includes(memory.id);
                return (
                  <button
                    key={memory.id}
                    type="button"
                    onClick={() => toggleInAlbum(memory.id)}
                    aria-pressed={inAlbum}
                    className={cn(
                      "relative aspect-square rounded-lg overflow-hidden border-2 transition-colors",
                      inAlbum ? "border-primary" : "border-transparent hover:border-white/20",
                    )}
                  >
                    <img
                      src={memory.imageUrl!}
                      alt={memory.title}
                      className="w-full h-full object-cover"
                    />
                    {inAlbum && (
                      <span className="absolute inset-0 bg-primary/25 flex items-center justify-center">
                        <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-semibold">
                          {order.indexOf(memory.id) + 1}
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <Button onClick={() => setPicking(false)} className="mt-4 w-full">
            Done
          </Button>
        </DialogContent>
      </Dialog>

      {slideshowFrom !== null && (
        <Slideshow
          slides={photos.map((p) => ({
            id: p.memoryId,
            imageUrl: p.imageUrl!,
            title: p.title,
            description: p.description,
            dateTaken: p.dateTaken,
          }))}
          startAt={slideshowFrom}
          musicUrl={album.musicUrl}
          onClose={() => setSlideshowFrom(null)}
        />
      )}
    </PageLayout>
  );
}

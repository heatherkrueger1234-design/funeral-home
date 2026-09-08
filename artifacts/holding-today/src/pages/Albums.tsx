import { useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Images, Plus } from "lucide-react";
import {
  getGetAlbumsQueryKey,
  useCreateAlbum,
  useGetAlbums,
} from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/**
 * Albums, which are selections of the memory wall rather than folders in it.
 *
 * Nothing here can lose a photograph. Deleting an album deletes the album;
 * the pictures stay on the wall. That is enforced on the server, and it is
 * said out loud on the page too, because somebody sorting through pictures of
 * their child at midnight should not have to guess.
 */

export default function Albums() {
  const { data: albums, refetch } = useGetAlbums({
    query: { queryKey: getGetAlbumsQueryKey() },
  });
  const { mutate: createAlbum, isPending } = useCreateAlbum();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    createAlbum(
      { data: { title: title.trim(), description: description.trim() || null } },
      {
        onSuccess: () => {
          toast({ title: "Album started" });
          setIsOpen(false);
          setTitle("");
          setDescription("");
          refetch();
        },
      },
    );
  };

  return (
    <PageLayout>
      <PageHeader
        title="Albums"
        description="Gather photographs into something you can watch, or print."
        action={
          <Button
            onClick={() => setIsOpen(true)}
            className="bg-primary text-primary-foreground rounded-full px-6 shadow-lg shadow-primary/20"
          >
            <Plus className="w-4 h-4 mr-2" /> New album
          </Button>
        }
      />

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="bg-card border-white/10 text-foreground sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">A new album</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="album-title">What is it called?</Label>
              <Input
                id="album-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Christmases, or His last year, or For his grandmother"
                required
                className="bg-background border-white/10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="album-desc">Anything you want to say about it</Label>
              <Textarea
                id="album-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-background border-white/10 resize-none h-20"
              />
            </div>
            <Button
              type="submit"
              disabled={isPending || !title.trim()}
              className="w-full mt-2 bg-primary text-primary-foreground"
            >
              {isPending ? "Creating…" : "Create the album"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {!albums?.length ? (
        <EmptyState
          icon={Images}
          title="No albums yet"
          description="An album is a set of photographs from the memory wall, in an order you choose. Nothing is moved or copied — the pictures stay exactly where they are."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {albums.map((album) => (
            <motion.div
              key={album.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Link
                href={`/albums/${album.id}`}
                className="glass-panel rounded-2xl overflow-hidden block group focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <div className="aspect-[4/3] bg-secondary/60 overflow-hidden">
                  {album.coverImageUrl ? (
                    <img
                      src={album.coverImageUrl}
                      alt=""
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Images className="w-10 h-10 text-muted-foreground/25" />
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <h2 className="font-display text-xl mb-1">{album.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {album.photoCount === 0
                      ? "Nothing in it yet"
                      : `${album.photoCount} photograph${album.photoCount === 1 ? "" : "s"}`}
                  </p>
                  {album.description && (
                    <p className="text-sm text-muted-foreground/80 mt-2 line-clamp-2">
                      {album.description}
                    </p>
                  )}
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}

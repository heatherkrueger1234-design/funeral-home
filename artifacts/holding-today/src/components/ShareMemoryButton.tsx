import { useState } from "react";
import { Check, Copy, Link2, Loader2, Trash2 } from "lucide-react";
import {
  getGetSharesQueryKey,
  useCreateShare,
  useDeleteShare,
  useGetShares,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

/**
 * Turning one memory into a link somebody without an account can open.
 *
 * The link is shown once, at creation, and never again — the server keeps only
 * a digest of it. That is a real cost to the person using it, so the dialog
 * says so plainly rather than letting them discover it by coming back for a
 * link that is no longer there.
 */
export function ShareMemoryButton({
  memoryId,
  title,
}: {
  memoryId: number;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Only fetched while the dialog is open: the memory wall renders one of
  // these per card, and none of them need the list until asked.
  const { data: shares, refetch } = useGetShares({
    query: { queryKey: getGetSharesQueryKey(), enabled: open },
  });
  const { mutate: create, isPending } = useCreateShare();
  const { mutate: revoke } = useDeleteShare();
  const { toast } = useToast();

  const existing = shares?.filter(
    (share) => share.kind === "memory" && share.resourceId === memoryId,
  );

  const absolute = (path: string) => `${window.location.origin}${path}`;

  const make = () => {
    create(
      { data: { kind: "memory", resourceId: memoryId, label: title } },
      {
        onSuccess: (created) => {
          setFreshUrl(absolute(created.url));
          setCopied(false);
          refetch();
        },
      },
    );
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Couldn't copy that",
        description: "Select the link and copy it by hand.",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          setFreshUrl(null);
          setOpen(true);
        }}
        aria-label={`Share ${title}`}
        className="opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
      >
        <Link2 className="w-4 h-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md rounded-2xl border-white/10">
          <DialogTitle className="font-display text-xl pr-6">
            Share “{title}”
          </DialogTitle>

          <p className="text-sm text-muted-foreground leading-relaxed">
            A read-only page showing just this one memory. Anyone with the link
            can open it without an account — and nothing else in here is
            reachable from it.
          </p>

          {freshUrl ? (
            <div className="rounded-xl border border-primary/25 bg-primary/[0.07] p-4">
              <p className="text-xs uppercase tracking-wider text-primary/70 mb-2">
                Copy this now — it is not shown again
              </p>
              <p className="text-sm text-foreground/90 break-all mb-3">
                {freshUrl}
              </p>
              <Button
                onClick={() => copy(freshUrl)}
                className="bg-primary text-primary-foreground w-full"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-2" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" /> Copy the link
                  </>
                )}
              </Button>
            </div>
          ) : (
            <Button
              onClick={make}
              disabled={isPending}
              className="bg-primary text-primary-foreground w-full"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Making a link…
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4 mr-2" /> Make a link
                </>
              )}
            </Button>
          )}

          {existing && existing.length > 0 && (
            <div className="border-t border-white/10 pt-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground/60 mb-3">
                Links you have made for this
              </p>
              <div className="space-y-2">
                {existing.map((share) => (
                  <div
                    key={share.id}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                  >
                    <span className="text-sm text-muted-foreground flex-1 truncate">
                      Made {new Date(share.createdAt).toLocaleDateString()}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        revoke({ id: share.id }, { onSuccess: () => refetch() })
                      }
                      aria-label="Turn off this link"
                      className="text-muted-foreground/60 hover:text-destructive transition-colors p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground/60 leading-relaxed mt-3">
                Turning a link off stops it working immediately, for everyone
                who has it.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

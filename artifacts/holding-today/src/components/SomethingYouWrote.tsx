import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, RefreshCw, X } from "lucide-react";
import {
  getGetResurfacedQueryKey,
  useGetResurfaced,
} from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { formatDate } from "@/lib/utils";

/**
 * A door, not a notification.
 *
 * This site's own guide tells people to turn off photo memory notifications,
 * because "you can go and look at him on purpose instead, which is an entirely
 * different experience from being ambushed by him." That sentence is the spec
 * for this component.
 *
 * So: nothing is fetched until the panel is opened. `enabled: open` is not a
 * performance decision — it is the feature. Until somebody chooses, the page
 * holds a closed door and no content at all, and closing it puts the content
 * away again rather than leaving it on screen.
 */
export function SomethingYouWrote() {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);

  const { data, isFetching, refetch } = useGetResurfaced({
    // The whole point: no request goes out until the door is opened.
    query: { queryKey: [...getGetResurfacedQueryKey(), nonce], enabled: open },
  });

  if (!user?.resurfacingEnabled) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full glass-panel rounded-2xl px-5 py-4 flex items-center gap-3.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        <div className="p-2.5 bg-primary/10 rounded-xl flex-shrink-0">
          <BookOpen className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-foreground">Something you wrote</p>
          <p className="text-sm text-muted-foreground">
            Open this when you want it. It will not arrive on its own.
          </p>
        </div>
      </button>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel rounded-2xl p-5 md:p-6"
      aria-label="Something you wrote"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <p className="text-sm uppercase tracking-[0.16em] text-primary/60">
          {data?.found ? data.label : "Something you wrote"}
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Put this away"
          className="text-muted-foreground/50 hover:text-foreground transition-colors p-1 -m-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${nonce}-${data?.sourceId ?? "none"}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {isFetching ? (
            <div className="h-24 flex items-center">
              <div className="w-5 h-5 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            </div>
          ) : !data?.found ? (
            <p className="text-muted-foreground leading-relaxed">
              There is nothing here yet. Once you have saved a memory, a song,
              or answered one of the small questions, this is where they come
              back to you.
            </p>
          ) : (
            <>
              {data.imageUrl && (
                <img
                  src={data.imageUrl}
                  alt=""
                  className="w-full max-h-72 object-cover rounded-xl border border-white/10 mb-4"
                />
              )}
              {data.title && (
                <p className="font-display text-xl text-foreground mb-2">
                  {data.title}
                </p>
              )}
              {data.body && (
                <p className="text-foreground/85 leading-relaxed whitespace-pre-wrap">
                  {data.body}
                </p>
              )}
              {data.writtenAt && (
                <p className="text-xs text-muted-foreground/60 mt-4">
                  You wrote this {formatDate(data.writtenAt.slice(0, 10))}
                </p>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {data?.found && (
        <button
          type="button"
          onClick={() => {
            setNonce((n) => n + 1);
            refetch();
          }}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mt-5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Show me another
        </button>
      )}
    </motion.section>
  );
}

import { Link, useRoute } from "wouter";
import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import {
  getGetSharedItemQueryKey,
  useGetSharedItem,
} from "@workspace/api-client-react";
import { formatDate } from "@/lib/utils";

/**
 * One memory, shown to somebody with no account.
 *
 * This is the only page in the application that renders another person's
 * writing without a session, so it renders exactly what the endpoint gave it
 * and nothing else — no sidebar, no navigation into the app, no invitation to
 * poke at anything. A revoked or mistyped link gets a plain, gentle page
 * rather than an error: the person holding it is usually a grandparent who was
 * sent it in a text message.
 */
export default function SharedMemory() {
  const [, params] = useRoute("/shared/:token");
  const token = params?.token ?? "";

  const { data, isLoading, isError } = useGetSharedItem(token, {
    query: {
      queryKey: getGetSharedItemQueryKey(token),
      // A dead link is the expected answer here, not a transient fault.
      retry: false,
      enabled: token.length > 0,
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-5">
        <div className="text-center max-w-sm">
          <Heart className="w-8 h-8 text-primary/40 mx-auto mb-5" />
          <h1 className="font-display text-2xl mb-3">This link isn't working</h1>
          <p className="text-muted-foreground leading-relaxed">
            It may have been turned off, or the address may have been cut short
            somewhere along the way. Ask the person who sent it for a new one.
          </p>
          <Link href="/" className="inline-block mt-8 text-sm text-primary hover:underline">
            Holding Today
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-5 py-12 md:py-20">
        <motion.article
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          {data.childName && (
            <p className="text-sm uppercase tracking-[0.18em] text-primary/60 mb-4">
              A memory of {data.childName}
            </p>
          )}

          <h1 className="font-display text-3xl md:text-4xl mb-3">{data.title}</h1>

          {data.dateTaken && (
            <p className="text-muted-foreground mb-8">{formatDate(data.dateTaken)}</p>
          )}

          {data.imageUrl && (
            <img
              src={data.imageUrl}
              alt={data.title}
              className="w-full rounded-2xl border border-white/10 mb-8"
            />
          )}

          {data.description && (
            <p className="text-foreground/85 text-lg leading-relaxed whitespace-pre-wrap">
              {data.description}
            </p>
          )}

          <div className="mt-16 pt-8 border-t border-white/10">
            <p className="text-sm text-muted-foreground leading-relaxed">
              This was shared with you privately. It is one page, and it can be
              turned off at any time by the person who sent it.
            </p>
            <Link
              href="/"
              className="inline-block mt-4 text-sm text-primary hover:underline"
            >
              Holding Today
            </Link>
          </div>
        </motion.article>
      </div>
    </div>
  );
}

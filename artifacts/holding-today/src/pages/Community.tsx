import { useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Flag,
  Loader2,
  MessageCircle,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import {
  getGetCommunityPostsQueryKey,
  useGetCommunityPosts,
  useCreateCommunityPost,
  useDeleteCommunityPost,
  useGetCommunityPost,
  useCreateCommunityComment,
  useDeleteCommunityComment,
  useReportCommunityContent,
  type CommunityPost,
} from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CrisisLine } from "@/components/CrisisHelp";
import { cn } from "@/lib/utils";

/**
 * The one room where people here can see each other.
 *
 * Everything else in this app is private. This page is the exception, and the
 * interface is written to keep saying so — what you post here is read by other
 * people, under a name that is not yours, and you can take it down.
 *
 * The compose box does not use the word "share" or "post to the community".
 * A bereaved parent typing at 3am is not publishing content; the wording tries
 * to make clear, without lecturing, that other people will read it.
 */

const KINDS = [
  {
    value: "signs" as const,
    label: "Signs",
    blurb: "Lights, songs, feathers, dreams. What you saw, and what you make of it.",
  },
  {
    value: "story" as const,
    label: "Stories",
    blurb: "Something about them, or about a day you got through.",
  },
  {
    value: "advice" as const,
    label: "What helped",
    blurb: "Something you wish somebody had told you.",
  },
];

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

const REPORT_REASONS = [
  { value: "cruel", label: "Cruel or abusive" },
  { value: "worried_about_them", label: "I'm worried about this person" },
  { value: "selling", label: "Selling something" },
  { value: "spam", label: "Spam" },
  { value: "graphic", label: "Graphic detail with no warning" },
  { value: "personal_information", label: "Personal information" },
  { value: "other", label: "Something else" },
] as const;

function ReportButton({
  targetType,
  targetId,
}: {
  targetType: "post" | "comment";
  targetId: number;
}) {
  const [open, setOpen] = useState(false);
  const { mutate: report, isPending } = useReportCommunityContent();
  const { toast } = useToast();

  const send = (reason: string) => {
    report(
      { data: { targetType, targetId, reason: reason as never } },
      {
        onSuccess: () => {
          setOpen(false);
          toast({
            title: "Thank you for telling us",
            description: "Someone will look at this.",
          });
        },
      },
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report this"
        className="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-1"
      >
        <Flag className="w-3.5 h-3.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm rounded-2xl border-white/10">
          <DialogTitle className="font-display text-lg pr-6">
            Tell us what's wrong
          </DialogTitle>
          <div className="space-y-2">
            {REPORT_REASONS.map((reason) => (
              <button
                key={reason.value}
                type="button"
                disabled={isPending}
                onClick={() => send(reason.value)}
                className="w-full text-left rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-foreground/90 hover:bg-white/[0.07] transition-colors disabled:opacity-50"
              >
                {reason.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            If you are worried somebody is in danger, say so above — and if it
            is urgent, encourage them to call or text 988.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Shown after posting something that reads like the author is in trouble. */
function CrisisAfterPost({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl border-white/10">
        <DialogTitle className="font-display text-xl pr-6">
          That's posted. Before you go.
        </DialogTitle>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Something in what you wrote sounded like you might be in a very bad
          place tonight. Nobody has removed anything and nobody is judging it —
          it just did not feel right to let it go by without saying this:
        </p>
        <CrisisLine />
      </DialogContent>
    </Dialog>
  );
}

function PostThread({ postId, onClose }: { postId: number; onClose: () => void }) {
  const { data: post, refetch, isLoading } = useGetCommunityPost(postId);
  const { mutate: comment, isPending } = useCreateCommunityComment();
  const { mutate: removeComment } = useDeleteCommunityComment();
  const [body, setBody] = useState("");
  const [crisis, setCrisis] = useState(false);

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    comment(
      { id: postId, data: { body: body.trim() } },
      {
        onSuccess: (created) => {
          setBody("");
          if (created.crisisPrompt) setCrisis(true);
          refetch();
        },
      },
    );
  };

  if (isLoading || !post) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary/60" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-6">
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          ← Back to the room
        </button>
      </div>

      <article className="glass-panel rounded-2xl p-5 md:p-6 mb-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h2 className="font-display text-xl md:text-2xl text-foreground">
              {post.title}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {post.screenName} · {timeAgo(post.createdAt)}
            </p>
          </div>
          {!post.isMine && <ReportButton targetType="post" targetId={post.id} />}
        </div>
        <p className="text-foreground/85 leading-relaxed whitespace-pre-wrap">
          {post.body}
        </p>
      </article>

      <div className="space-y-3 mb-6">
        {post.comments.map((reply) => (
          <div
            key={reply.id}
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4"
          >
            <div className="flex items-start justify-between gap-4 mb-1.5">
              <p className="text-sm text-muted-foreground">
                {reply.screenName} · {timeAgo(reply.createdAt)}
              </p>
              <div className="flex items-center gap-1">
                {reply.isMine ? (
                  <button
                    type="button"
                    onClick={() =>
                      removeComment({ id: reply.id }, { onSuccess: () => refetch() })
                    }
                    aria-label="Delete your reply"
                    className="text-muted-foreground/40 hover:text-destructive transition-colors p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <ReportButton targetType="comment" targetId={reply.id} />
                )}
              </div>
            </div>
            <p className="text-foreground/85 leading-relaxed whitespace-pre-wrap">
              {reply.body}
            </p>
          </div>
        ))}
      </div>

      <form onSubmit={send} className="glass-panel rounded-2xl p-5">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Say something to them. You do not have to fix it."
          className="w-full bg-background border border-white/10 rounded-xl p-3 text-foreground min-h-[90px] resize-y"
        />
        <Button
          type="submit"
          disabled={isPending || !body.trim()}
          className="bg-primary text-primary-foreground mt-3"
        >
          {isPending ? "Posting…" : "Reply"}
        </Button>
      </form>

      <CrisisAfterPost open={crisis} onOpenChange={setCrisis} />
    </>
  );
}

function Compose({ onPosted }: { onPosted: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("signs");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [screenName, setScreenName] = useState("");
  const [crisis, setCrisis] = useState(false);
  const { mutate: create, isPending } = useCreateCommunityPost();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    create(
      {
        data: {
          kind,
          title: title.trim(),
          body: body.trim(),
          screenName: screenName.trim() || null,
        },
      },
      {
        onSuccess: (created) => {
          setTitle("");
          setBody("");
          setOpen(false);
          if (created.crisisPrompt) setCrisis(true);
          onPosted();
        },
      },
    );
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="bg-primary text-primary-foreground rounded-full px-6"
      >
        <Plus className="w-4 h-4 mr-2" /> Add something
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg rounded-2xl border-white/10 max-h-[88vh] overflow-y-auto">
          <DialogTitle className="font-display text-xl pr-6">
            Add something to the room
          </DialogTitle>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Other parents here will read this. Your name and your email are
            never shown — only the name below. You can take it down at any
            time.
          </p>

          <form onSubmit={submit} className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {KINDS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setKind(option.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                    kind === option.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A few words"
              maxLength={140}
              required
              className="bg-background border-white/10"
            />

            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={KINDS.find((k) => k.value === kind)?.blurb}
              required
              maxLength={8000}
              className="w-full bg-background border border-white/10 rounded-xl p-3 text-foreground min-h-[150px] resize-y"
            />

            <div>
              <Input
                value={screenName}
                onChange={(e) => setScreenName(e.target.value)}
                placeholder="A name to post under (optional)"
                maxLength={32}
                className="bg-background border-white/10"
              />
              <p className="text-xs text-muted-foreground/70 mt-1.5 leading-relaxed">
                Leave this blank and one is picked for you. Whatever it ends up
                being, it stays the same on everything you post — so people can
                recognise you without knowing you.
              </p>
            </div>

            <Button
              type="submit"
              disabled={isPending || !title.trim() || !body.trim()}
              className="w-full bg-primary text-primary-foreground"
            >
              {isPending ? "Posting…" : "Add it"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <CrisisAfterPost open={crisis} onOpenChange={setCrisis} />
    </>
  );
}

export default function Community() {
  const [kind, setKind] = useState<string | null>(null);
  const [openPostId, setOpenPostId] = useState<number | null>(null);

  const { data: posts, refetch } = useGetCommunityPosts(
    kind ? { kind: kind as never } : undefined,
    { query: { queryKey: getGetCommunityPostsQueryKey(kind ? { kind: kind as never } : undefined) } },
  );
  const { mutate: removePost } = useDeleteCommunityPost();

  if (openPostId !== null) {
    return (
      <PageLayout>
        <PostThread
          postId={openPostId}
          onClose={() => {
            setOpenPostId(null);
            refetch();
          }}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title="The room"
        description="The only part of this site other people can see. Everything else stays yours."
        action={<Compose onPosted={() => refetch()} />}
      />

      <div className="flex flex-wrap gap-2 mb-6">
        <button
          type="button"
          onClick={() => setKind(null)}
          className={cn(
            "px-3.5 py-1.5 rounded-full text-sm border transition-colors",
            kind === null
              ? "bg-primary/20 border-primary/40 text-primary"
              : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10",
          )}
        >
          Everything
        </button>
        {KINDS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setKind(option.value)}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-sm border transition-colors",
              kind === option.value
                ? "bg-primary/20 border-primary/40 text-primary"
                : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {!posts?.length ? (
        <EmptyState
          icon={Users}
          title="Nobody has written anything here yet"
          description="This is the one place on the site where other bereaved parents can see what you write. If you have a sign you have never told anyone about, this is where it goes."
        />
      ) : (
        <div className="space-y-3">
          {posts.map((post: CommunityPost, i) => (
            <motion.button
              key={post.id}
              type="button"
              onClick={() => setOpenPostId(post.id)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
              className="glass-panel rounded-2xl p-5 w-full text-left hover:bg-white/[0.03] transition-colors block"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-xs px-2 py-0.5 rounded-full border border-white/10 text-muted-foreground">
                      {KINDS.find((k) => k.value === post.kind)?.label ?? post.kind}
                    </span>
                    {post.isMine && (
                      <span className="text-xs px-2 py-0.5 rounded-full border border-primary/30 text-primary/80">
                        Yours
                      </span>
                    )}
                  </div>
                  <h3 className="font-display text-lg text-foreground break-words">
                    {post.title}
                  </h3>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1 whitespace-pre-wrap">
                    {post.body}
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-2.5 flex items-center gap-3">
                    <span>
                      {post.screenName} · {timeAgo(post.createdAt)}
                    </span>
                    {post.commentCount > 0 && (
                      <span className="flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" />
                        {post.commentCount}
                      </span>
                    )}
                  </p>
                </div>

                {post.isMine && (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Delete your post"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!confirm("Take this down?")) return;
                      removePost({ id: post.id }, { onSuccess: () => refetch() });
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.stopPropagation();
                      removePost({ id: post.id }, { onSuccess: () => refetch() });
                    }}
                    className="text-muted-foreground/40 hover:text-destructive transition-colors p-1 flex-shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </span>
                )}
              </div>
            </motion.button>
          ))}
        </div>
      )}

      <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <p className="flex gap-3 text-sm text-muted-foreground leading-relaxed">
          <Activity className="w-4 h-4 flex-shrink-0 text-primary/60 mt-0.5" />
          <span>
            This room is only for people with an account here, and it is not
            visible to the public or to search engines. Be careful with details
            that would identify your family — a name, a school, a town. If
            somebody is cruel, or is selling something, use the flag and
            somebody will look at it.
          </span>
        </p>
      </div>
    </PageLayout>
  );
}

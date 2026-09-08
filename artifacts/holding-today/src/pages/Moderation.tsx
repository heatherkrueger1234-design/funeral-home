import { EyeOff, Eye, ShieldCheck } from "lucide-react";
import {
  useGetCommunityReports,
  useHideCommunityContent,
} from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";

/**
 * The moderation queue.
 *
 * A public room on a site for bereaved parents needs somebody able to remove
 * what turns up in it, and this is that person's screen. It shows what was
 * reported alongside the report, so that a decision about somebody's account
 * of their child's death is never made from a reason code alone.
 *
 * Hiding is reversible on purpose, and the page says so — the failure mode
 * here is a moderator hesitating over a borderline post because they think
 * removing it is final.
 */

const REASON_LABELS: Record<string, string> = {
  cruel: "Cruel or abusive",
  worried_about_them: "Worried about this person",
  selling: "Selling something",
  spam: "Spam",
  graphic: "Graphic detail",
  personal_information: "Personal information",
  other: "Something else",
};

export default function Moderation() {
  const { user } = useSession();
  const { data: reports, refetch } = useGetCommunityReports({
    query: { enabled: Boolean(user?.isModerator), queryKey: ["moderation-reports"] },
  });
  const { mutate: hide, isPending } = useHideCommunityContent();

  if (!user?.isModerator) {
    return (
      <PageLayout>
        <EmptyState
          icon={ShieldCheck}
          title="This page is for moderators"
          description="Nothing here concerns your account."
        />
      </PageLayout>
    );
  }

  const act = (
    targetType: string,
    targetId: number,
    hidden: boolean,
    reason?: string,
  ) => {
    hide(
      {
        data: {
          targetType: targetType as never,
          targetId,
          hidden,
          reason: reason ?? null,
        },
      },
      { onSuccess: () => refetch() },
    );
  };

  return (
    <PageLayout>
      <PageHeader
        title="Reports"
        description="What people in the room have flagged, and what they flagged it for."
      />

      {!reports?.length ? (
        <EmptyState
          icon={ShieldCheck}
          title="Nothing waiting"
          description="No open reports. This page fills up on its own when somebody flags something."
        />
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <div key={report.id} className="glass-panel rounded-2xl p-5">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs px-2 py-0.5 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-200">
                  {REASON_LABELS[report.reason] ?? report.reason}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full border border-white/10 text-muted-foreground">
                  {report.targetType === "post" ? "Post" : "Reply"}
                </span>
                {report.reportCount > 1 && (
                  <span className="text-xs px-2 py-0.5 rounded-full border border-white/10 text-muted-foreground">
                    {report.reportCount} people
                  </span>
                )}
                {report.targetHidden && (
                  <span className="text-xs px-2 py-0.5 rounded-full border border-rose-400/30 bg-rose-400/10 text-rose-200">
                    Hidden
                  </span>
                )}
              </div>

              {report.note && (
                <p className="text-sm text-muted-foreground italic mb-3">
                  “{report.note}”
                </p>
              )}

              <div className="rounded-xl border border-white/10 bg-background/50 p-4 mb-4">
                <p className="text-xs text-muted-foreground/60 mb-2">
                  {report.targetScreenName ?? "unknown"}
                </p>
                <p className="text-foreground/85 leading-relaxed whitespace-pre-wrap text-sm">
                  {report.targetBody ?? "(this has since been deleted by its author)"}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {report.targetHidden ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isPending}
                    onClick={() => act(report.targetType, report.targetId, false)}
                  >
                    <Eye className="w-4 h-4 mr-2" /> Put it back
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={isPending}
                    onClick={() =>
                      act(report.targetType, report.targetId, true, report.reason)
                    }
                    className="bg-rose-500/80 text-white hover:bg-rose-500"
                  >
                    <EyeOff className="w-4 h-4 mr-2" /> Hide it
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => act(report.targetType, report.targetId, false)}
                  className="text-muted-foreground"
                >
                  Leave it up
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-sm text-muted-foreground/70 leading-relaxed mt-8 max-w-2xl">
        Hiding is reversible, and hidden posts are kept rather than deleted, so
        nothing here is a decision you cannot walk back. Either button closes
        the report.
      </p>
    </PageLayout>
  );
}

import { useState } from "react";
import { Link, useRoute, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCase,
  useCloseCase,
  getGetCaseQueryKey,
  getGetCasesQueryKey,
  getGetHomeDashboardQueryKey,
  getGetHomeInboxQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { FamilyPanel } from "@/components/case/FamilyPanel";
import { PhotosPanel } from "@/components/case/PhotosPanel";
import { ObituaryPanel } from "@/components/case/ObituaryPanel";
import { ServicePanel } from "@/components/case/ServicePanel";
import { TimelinePanel } from "@/components/case/TimelinePanel";
import { MessagesPanel } from "@/components/case/MessagesPanel";
import { BelongingsPanel } from "@/components/case/BelongingsPanel";
import { VitalsPanel } from "@/components/case/VitalsPanel";
import { PrintPanel } from "@/components/case/PrintPanel";
import { MemoryBookPanel } from "@/components/case/MemoryBookPanel";
import { DetailsPanel } from "@/components/case/DetailsPanel";
import { CaseData } from "@/components/CaseData";
import { Empty, Loading } from "@/components/page";
import { formatAtHome } from "@/lib/utils";
import { useHomeZone, useSession } from "@/lib/session";
import { ArrowLeft, CalendarX, FileQuestion } from "lucide-react";

/**
 * "Sat 26 Sep, 4:51 pm" — the day of the week is half of how a date is read
 * here. On the home's clock (`formatAtHome`), so a director away from the
 * office reads the hour the family will arrive, not the hour where they are.
 */
function serviceLabel(value: string | Date, zone: string | undefined): string {
  return (
    formatAtHome(value, zone, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }) || "—"
  );
}

const TABS = [
  "family",
  "photos",
  "vitals",
  "belongings",
  "obituary",
  "service",
  "print",
  "book",
  "timeline",
  "messages",
  "details",
  "data",
];

/**
 * "…the thread locks two weeks after the service." The window is the home's
 * own setting, so the sentence reads it rather than assuming the default.
 */
function lockWindow(days: number | undefined): string {
  if (!days) return "after the service";
  if (days % 7 === 0) {
    const weeks = days / 7;
    return `${weeks === 1 ? "a week" : `${weeks} weeks`} after the service`;
  }
  return `${days === 1 ? "a day" : `${days} days`} after the service`;
}

export default function CaseDetail() {
  const [, params] = useRoute("/cases/:caseId");
  const caseId = Number(params?.caseId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  /*
   * A link may say which tab it is for -- the inbox opens the thread, the
   * master page's past-due rows open the timeline -- so a director lands on
   * the thing they clicked rather than on the family list every time.
   */
  const requested = new URLSearchParams(useSearch()).get("tab");
  const [tab, setTab] = useState(
    requested && TABS.includes(requested) ? requested : "family",
  );
  const zone = useHomeZone();
  const { session } = useSession();
  const locksAfter = lockWindow(session?.home.messageLockDays);

  const row = useGetCase(caseId, {
    query: {
      queryKey: getGetCaseQueryKey(caseId),
      enabled: Number.isInteger(caseId),
    },
  });

  const close = useCloseCase({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
        void queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });
        void queryClient.invalidateQueries({
          queryKey: getGetHomeDashboardQueryKey(),
        });
        void queryClient.invalidateQueries({ queryKey: getGetHomeInboxQueryKey() });
        toast({
          title: "Case closed",
          description: `The family's thread locks ${locksAfter}, and their aftercare is waiting on their consent.`,
        });
      },
    },
  });

  if (row.isPending) return <Loading rows={4} />;

  if (!row.data) {
    return (
      <Empty icon={FileQuestion} title="That case isn't here">
        It may have been closed and removed, or the address may be wrong.
      </Empty>
    );
  }

  const detail = row.data;
  const closed = detail.status === "closed";

  return (
    <div className="space-y-6">
      {/*
        The way back. A case is the one screen in the console reached from a
        list rather than from the bar across the top, and it was the one
        screen with nothing on it that led back to that list — the nav's
        "Cases" does the job, but only for somebody who has worked out that a
        case counts as being inside it.
      */}
      <Link
        href="/cases"
        className="group inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground
                   no-underline transition-colors duration-200 hover:text-foreground"
      >
        <ArrowLeft
          className="size-4 transition-transform duration-200 ease-[cubic-bezier(0.2,0.6,0.3,1)] group-hover:-translate-x-0.5"
          strokeWidth={1.75}
        />
        All cases
      </Link>

      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[1.75rem] leading-tight">
            {detail.displayName}
          </h1>
          {/*
            A director opening this must know before they read anything else
            whether this person has died. Offering condolences to a pre-need
            planner is the mistake this label exists to prevent.
          */}
          {detail.kind === "pre_need" && (
            <p className="mb-1.5 mt-2 inline-block rounded-full border border-[var(--accent)]/30
                          bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold
                          text-[var(--accent-deep)]">
              Planning ahead — {detail.displayName} is living
            </p>
          )}
          <p className="mt-1 text-muted-foreground">
            {closed
              ? detail.kind === "pre_need"
                ? "Plan complete"
                : "Closed"
              : detail.status === "intake"
                ? "Intake — the family has not been invited yet"
                : "Active"}
            {detail.leadDirector?.displayName
              ? ` · ${detail.leadDirector.displayName}`
              : ""}
          </p>

          {/*
            The service, in the header, where it is read rather than looked
            for.

            Everything on this page hangs off this one date: the standard
            schedule is written as offsets from it, the thread locks a
            fortnight after it, and the printer and the church are waiting on
            it. It was reachable — two tabs along, under Service — which meant
            a director answering "when is Mrs Hale's funeral?" on the
            telephone had to go and find it on the screen already open in
            front of them.

            Its absence is worth as much ink as its presence, and gets it.
            The master page lists a case with no service date as the quietest
            way this product fails; this is that same fact, said on the case
            itself instead of only about it.
          */}
          {!closed &&
            (detail.serviceAt ? (
              <p className="mt-2 text-sm">
                <span className="eyebrow mr-2">Service</span>
                <span className="tabular font-semibold">
                  {serviceLabel(detail.serviceAt, zone)}
                </span>
                {detail.serviceLocation && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {detail.serviceLocation}
                  </span>
                )}
              </p>
            ) : (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--notice)]/30
                            bg-[var(--notice-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--notice)]">
                <CalendarX className="size-3.5" strokeWidth={2} aria-hidden />
                No service date — the timeline is empty until there is one
              </p>
            ))}
        </div>

        {!closed && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">Close the case</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Close this case?</AlertDialogTitle>
                <AlertDialogDescription>
                  The family keeps access to everything they added. Their
                  message thread locks {locksAfter}, and anyone who left an
                  address is offered the grief check-ins in your name —
                  nothing is sent until they say yes.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Not yet</AlertDialogCancel>
                <AlertDialogAction onClick={() => close.mutate({ caseId })}>
                  Close it
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="family">Family</TabsTrigger>
          <TabsTrigger value="photos">Photos ({detail.photoCount})</TabsTrigger>
          <TabsTrigger value="vitals">Certificate</TabsTrigger>
          <TabsTrigger value="belongings">Belongings</TabsTrigger>
          <TabsTrigger value="obituary">Obituary</TabsTrigger>
          <TabsTrigger value="service">Service</TabsTrigger>
          <TabsTrigger value="print">Print</TabsTrigger>
          {/* Not on a pre-need file: a memory book is about somebody who has died. */}
          {detail.kind !== "pre_need" && (
            <TabsTrigger value="book">Memory book</TabsTrigger>
          )}
          <TabsTrigger value="timeline">
            Timeline
            {detail.outstandingDeadlines > 0 && (
              <span className="tabular rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                {detail.outstandingDeadlines}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="messages">
            Messages
            {detail.unreadFamilyMessages > 0 && (
              <span className="tabular rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-xs font-semibold text-white">
                {detail.unreadFamilyMessages}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="family">
            <FamilyPanel caseId={caseId} contacts={detail.contacts} />
          </TabsContent>
          <TabsContent value="photos">
            <PhotosPanel
              caseId={caseId}
              portraitPhotoId={detail.portraitPhotoId}
              referencePhotoId={detail.referencePhotoId}
            />
          </TabsContent>
          <TabsContent value="vitals">
            <VitalsPanel caseId={caseId} />
          </TabsContent>
          <TabsContent value="belongings">
            <BelongingsPanel caseId={caseId} />
          </TabsContent>
          <TabsContent value="obituary">
            <ObituaryPanel caseId={caseId} />
          </TabsContent>
          <TabsContent value="service">
            <ServicePanel caseId={caseId} />
          </TabsContent>
          <TabsContent value="print">
            <PrintPanel caseId={caseId} />
          </TabsContent>
          {detail.kind !== "pre_need" && (
            <TabsContent value="book">
              <MemoryBookPanel caseId={caseId} displayName={detail.displayName} />
            </TabsContent>
          )}
          <TabsContent value="timeline">
            <TimelinePanel
              caseId={caseId}
              serviceAt={detail.serviceAt}
              dateOfDeath={detail.dateOfDeath}
            />
          </TabsContent>
          <TabsContent value="messages">
            <MessagesPanel caseId={caseId} />
          </TabsContent>
          <TabsContent value="details">
            <DetailsPanel caseId={caseId} detail={detail} />
          </TabsContent>
          <TabsContent value="data">
            <CaseData
              caseId={caseId}
              displayName={detail.displayName}
              kind={detail.kind}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

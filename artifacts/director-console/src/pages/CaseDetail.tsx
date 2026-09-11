import { useState } from "react";
import { useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCase,
  useCloseCase,
  getGetCaseQueryKey,
  getGetCasesQueryKey,
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
import { Loader2 } from "lucide-react";
import { FamilyPanel } from "@/components/case/FamilyPanel";
import { PhotosPanel } from "@/components/case/PhotosPanel";
import { ObituaryPanel } from "@/components/case/ObituaryPanel";
import { ServicePanel } from "@/components/case/ServicePanel";
import { TimelinePanel } from "@/components/case/TimelinePanel";
import { MessagesPanel } from "@/components/case/MessagesPanel";
import { BelongingsPanel } from "@/components/case/BelongingsPanel";
import { VitalsPanel } from "@/components/case/VitalsPanel";
import { PrintPanel } from "@/components/case/PrintPanel";
import { DetailsPanel } from "@/components/case/DetailsPanel";

export default function CaseDetail() {
  const [, params] = useRoute("/cases/:caseId");
  const caseId = Number(params?.caseId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("family");

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
        toast({
          title: "Case closed",
          description:
            "The family's thread locks a fortnight after the service, and their aftercare is waiting on their consent.",
        });
      },
    },
  });

  if (row.isPending) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  if (!row.data) {
    return <p className="py-16 text-center text-muted-foreground">Not found.</p>;
  }

  const detail = row.data;
  const closed = detail.status === "closed";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl leading-tight">
            {detail.displayName}
          </h1>
          <p className="text-muted-foreground">
            {closed
              ? "Closed"
              : detail.status === "intake"
                ? "Intake — the family has not been invited yet"
                : "Active"}
            {detail.leadDirector?.displayName
              ? ` · ${detail.leadDirector.displayName}`
              : ""}
          </p>
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
                  message thread locks a fortnight after the service, and
                  anyone who left an address is offered the grief check-ins in
                  your name — nothing is sent until they say yes.
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
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="family">
            Family
            {detail.unreadFamilyMessages > 0 && (
              <span className="ml-1.5 rounded-full bg-[var(--accent)] px-1.5 text-xs text-white">
                {detail.unreadFamilyMessages}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="photos">Photographs ({detail.photoCount})</TabsTrigger>
          <TabsTrigger value="vitals">Certificate</TabsTrigger>
          <TabsTrigger value="belongings">Belongings</TabsTrigger>
          <TabsTrigger value="obituary">Obituary</TabsTrigger>
          <TabsTrigger value="service">Service</TabsTrigger>
          <TabsTrigger value="print">Print</TabsTrigger>
          <TabsTrigger value="timeline">
            Timeline
            {detail.outstandingDeadlines > 0 && (
              <span className="ml-1.5 text-muted-foreground">
                ({detail.outstandingDeadlines})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <div className="mt-5">
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
          <TabsContent value="timeline">
            <TimelinePanel caseId={caseId} serviceAt={detail.serviceAt} />
          </TabsContent>
          <TabsContent value="messages">
            <MessagesPanel caseId={caseId} />
          </TabsContent>
          <TabsContent value="details">
            <DetailsPanel caseId={caseId} detail={detail} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

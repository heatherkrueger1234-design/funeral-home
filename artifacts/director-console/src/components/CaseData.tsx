import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useDeleteCase,
  useConvertCaseToAtNeed,
  getGetCasesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Download, Loader2, Trash2, HeartCrack } from "lucide-react";

/**
 * The three things a home does with a case that are not working the case:
 * take the data out, record that a pre-need planner has died, and erase it.
 *
 * Grouped at the bottom of the case rather than in the header, because none of
 * them is a daily action and the last one is irreversible.
 */
export function CaseData({
  caseId,
  displayName,
  kind,
}: {
  caseId: number;
  displayName: string;
  kind: string;
}) {
  return (
    <section className="space-y-4">
      <div className="rounded-lg border p-4">
        <p className="font-medium mb-1">Take everything out</p>
        <p className="text-sm text-muted-foreground mb-3">
          A folder holding the photographs at full size, the obituary, the
          selections, the belongings and the message thread. Nothing in it needs
          this software to open, and it keeps working if you ever stop
          subscribing.
        </p>
        <Button variant="outline" size="sm" asChild>
          {/*
            A plain link rather than fetch-and-blob: the browser streams it
            straight to disk, which matters when the archive is a gigabyte of
            photographs and the alternative is holding all of it in a tab.
          */}
          <a href={`/api/cases/${caseId}/export`} download>
            <Download className="size-4" />
            Export this case
          </a>
        </Button>
      </div>

      {kind === "pre_need" && <ConvertToAtNeed caseId={caseId} displayName={displayName} />}

      <EraseCase caseId={caseId} displayName={displayName} />
    </section>
  );
}

function ConvertToAtNeed({
  caseId,
  displayName,
}: {
  caseId: number;
  displayName: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dateOfDeath, setDateOfDeath] = useState("");
  const [serviceAt, setServiceAt] = useState("");

  const convert = useConvertCaseToAtNeed({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries();
        setOpen(false);
        toast({
          title: "The file is now a case",
          description:
            "Everything they chose is already on it. The schedule has been built.",
        });
      },
    },
  });

  return (
    <div className="rounded-lg border p-4">
      <p className="font-medium mb-1">{displayName} has died</p>
      <p className="text-sm text-muted-foreground mb-3">
        This is a pre-need file. Recording the death turns it into an ordinary
        case and builds the schedule — everything they chose while they were
        well is already here, so there is nothing to re-type.
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <HeartCrack className="size-4" />
            Record the death
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record {displayName}&rsquo;s death</DialogTitle>
            <DialogDescription>
              There is no way back from this. If it is a mistake, the case can
              be erased, but it cannot be turned into a plan again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="dateOfDeath">Date of death</Label>
              <Input
                id="dateOfDeath"
                type="date"
                value={dateOfDeath}
                onChange={(event) => setDateOfDeath(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="serviceAt">Service, if it is known yet</Label>
              <Input
                id="serviceAt"
                type="datetime-local"
                value={serviceAt}
                onChange={(event) => setServiceAt(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!dateOfDeath || convert.isPending}
              onClick={() =>
                convert.mutate({
                  caseId,
                  data: {
                    dateOfDeath: new Date(dateOfDeath).toISOString(),
                    serviceAt: serviceAt
                      ? new Date(serviceAt).toISOString()
                      : null,
                  },
                })
              }
            >
              {convert.isPending && <Loader2 className="size-4 animate-spin" />}
              Record it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EraseCase({
  caseId,
  displayName,
}: {
  caseId: number;
  displayName: string;
}) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");

  const erase = useDeleteCase({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });
        setOpen(false);
        toast({
          title: "Erased",
          description:
            "Gone from this system. It stays in your backups until they age out.",
        });
        navigate("/");
      },
    },
  });

  // Compared the same way the server does, so the button's state never
  // disagrees with what happens when it is pressed.
  const matches = typed.trim().toLowerCase() === displayName.trim().toLowerCase();

  return (
    <div className="rounded-lg border border-destructive/40 p-4">
      <p className="font-medium mb-1">Erase this case</p>
      <p className="text-sm text-muted-foreground mb-3">
        Permanent. The photographs, the obituary, the messages, the belongings
        and the certificate details all go with it. Export first if you have any
        obligation to keep a record — you cannot undo this.
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive" size="sm">
            <Trash2 className="size-4" />
            Erase
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Erase {displayName}&rsquo;s case?</DialogTitle>
            <DialogDescription>
              This destroys the only copy of this family&rsquo;s photographs that
              exists outside your backups. To confirm, type the name exactly as
              it appears above.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="confirmName">Type &ldquo;{displayName}&rdquo;</Label>
              <Input
                id="confirmName"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="reason">Why (for your own records)</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="The family asked us to"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={!matches || erase.isPending}
              onClick={() =>
                erase.mutate({
                  caseId,
                  data: { confirmName: typed.trim(), reason: reason.trim() || null },
                })
              }
            >
              {erase.isPending && <Loader2 className="size-4 animate-spin" />}
              Erase it for good
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

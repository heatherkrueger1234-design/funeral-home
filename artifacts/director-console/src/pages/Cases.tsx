import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCases,
  useCreateCase,
  getGetCasesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ClipboardCheck,
  ClipboardList,
  Images,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  TriangleAlert,
} from "lucide-react";
import { ImportCases } from "@/components/ImportCases";
import { TrialBanner } from "@/components/SetupChecklist";
import { Empty, Loading, PageHeader } from "@/components/page";

/**
 * The worklist.
 *
 * A director opening this at eight in the morning is not asking which cases
 * exist — they know. They are asking which family is behind, and on what. So
 * the row leads with the name and then carries the three numbers that answer
 * it: messages waiting for a reply, things overdue, and photographs in.
 */

function formatService(value: string | Date | null): string {
  if (!value) return "No service date yet";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "No service date yet";

  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function NewCaseDialog() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [born, setBorn] = useState("");
  const [died, setDied] = useState("");
  const [serviceAt, setServiceAt] = useState("");

  const create = useCreateCase({
    mutation: {
      onSuccess: (row) => {
        void queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });
        setOpen(false);
        setFirst("");
        setLast("");
        setBorn("");
        setDied("");
        setServiceAt("");
        // Straight into the case: the next thing is always to invite the
        // family, and making them find the row again is a wasted click at
        // the worst moment of somebody's week.
        navigate(`/cases/${row.id}`);
      },
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Open a case
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open a case</DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({
              data: {
                decedentFirstName: first.trim(),
                decedentLastName: last.trim(),
                // Date fields arrive as "YYYY-MM-DD" and are stored as
                // midnight UTC, which is how every other screen reads them.
                ...(born ? { dateOfBirth: new Date(born).toISOString() } : {}),
                ...(died ? { dateOfDeath: new Date(died).toISOString() } : {}),
                ...(serviceAt
                  ? { serviceAt: new Date(serviceAt).toISOString() }
                  : {}),
              },
            });
          }}
        >
          <p className="text-sm text-muted-foreground">
            Only the name is needed. Add the dates you know and the family's
            timeline builds itself from your standard schedule; anything left
            empty can be filled in later, from either side.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="first">First name</Label>
              <Input
                id="first"
                required
                value={first}
                onChange={(event) => setFirst(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last">Last name</Label>
              <Input
                id="last"
                required
                value={last}
                onChange={(event) => setLast(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="born">Date of birth</Label>
              <Input
                id="born"
                type="date"
                value={born}
                onChange={(event) => setBorn(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="died">Date of death</Label>
              <Input
                id="died"
                type="date"
                value={died}
                onChange={(event) => setDied(event.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="newServiceAt">Service, once it is confirmed</Label>
              <Input
                id="newServiceAt"
                type="datetime-local"
                value={serviceAt}
                onChange={(event) => setServiceAt(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              Open it
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Cases() {
  const [showClosed, setShowClosed] = useState(false);
  const [search, setSearch] = useState("");

  const cases = useGetCases({
    status: showClosed ? "closed" : undefined,
    // The list is bounded, so searching is how an older case is reached.
    search: search.trim() || undefined,
  });

  const rows = (cases.data ?? []).filter((row) =>
    showClosed ? true : row.status !== "closed",
  );

  return (
    <div className="space-y-6">
      {/* The setup checklist moved to the landing page; the trial notice
          stays because this is where a director tries to open a case. */}
      <TrialBanner />

      <PageHeader
        title={showClosed ? "Closed cases" : "Cases"}
        aside={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowClosed((value) => !value)}
            >
              {showClosed ? "Show open" : "Show closed"}
            </Button>
            <ImportCases />
            <NewCaseDialog />
          </>
        }
      />

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.75}
        />
        <Input
          value={search}
          placeholder="Search by name"
          className="pl-10"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {cases.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        search.trim() ? (
          <Empty icon={Search} title={`Nothing matching "${search.trim()}"`}>
            Search covers the name on the case. Closed cases are hidden unless
            you ask for them.
          </Empty>
        ) : showClosed ? (
          <Empty icon={ClipboardCheck} title="Nothing closed yet">
            Cases appear here once you close them. Everything the family added
            stays with them.
          </Empty>
        ) : (
          <Empty
            icon={ClipboardList}
            title="No open cases"
            action={<NewCaseDialog />}
          >
            Open one with just a name — everything else can wait until you
            know it.
          </Empty>
        )
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/cases/${row.id}`}
                className="lift group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl
                           border border-border bg-card px-4 py-3.5 no-underline
                           shadow-[var(--elevation-1)] transition-gentle
                           hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))]"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">
                      {row.displayName}
                    </span>
                    {/*
                      Unmissable, and on the row rather than only inside the
                      case. A director scanning this list must never ring a
                      pre-need planner to offer condolences.
                    */}
                    {row.kind === "pre_need" && (
                      <span className="shrink-0 rounded-full border border-[var(--accent)]/30
                                       bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-semibold
                                       text-[var(--accent-deep)]">
                        Planning ahead
                      </span>
                    )}
                  </span>
                  <span className="block text-sm text-muted-foreground truncate">
                    {row.kind === "pre_need"
                      ? "Living — no service date"
                      : formatService(row.serviceAt)}
                    {row.nextOfKinName ? ` · ${row.nextOfKinName}` : ""}
                  </span>
                </span>

                {/*
                  The three numbers, each in a fixed-width cell so they line up
                  down the list. A director scanning forty rows for "who is
                  behind" is reading a column, not three floating badges that
                  move with the length of the name beside them.
                */}
                <span className="tabular flex shrink-0 items-center gap-1 text-sm">
                  <span className="grid w-14 place-items-center" title="Messages waiting for a reply">
                    {row.unreadFamilyMessages > 0 ? (
                      <span className="flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 font-semibold text-white">
                        <MessageCircle className="size-3.5" />
                        {row.unreadFamilyMessages}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-muted-foreground/35">
                        <MessageCircle className="size-3.5" />0
                      </span>
                    )}
                  </span>

                  <span className="grid w-12 place-items-center" title="Still outstanding with the family">
                    <span
                      className={
                        row.outstandingDeadlines > 0
                          ? "flex items-center gap-1 font-semibold text-[var(--notice)]"
                          : "flex items-center gap-1 text-muted-foreground/35"
                      }
                    >
                      <TriangleAlert className="size-3.5" />
                      {row.outstandingDeadlines}
                    </span>
                  </span>

                  <span className="grid w-12 place-items-center" title="Photographs in">
                    <span
                      className={
                        row.photoCount > 0
                          ? "flex items-center gap-1 text-muted-foreground"
                          : "flex items-center gap-1 text-muted-foreground/35"
                      }
                    >
                      <Images className="size-3.5" />
                      {row.photoCount}
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
import { Images, Loader2, MessageCircle, Plus, Search, TriangleAlert } from "lucide-react";
import { ImportCases } from "@/components/ImportCases";

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

  const create = useCreateCase({
    mutation: {
      onSuccess: (row) => {
        void queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });
        setOpen(false);
        setFirst("");
        setLast("");
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
              },
            });
          }}
        >
          <p className="text-sm text-muted-foreground">
            Just the name for now. Everything else can wait until you know it.
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
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl">
          {showClosed ? "Closed cases" : "Cases"}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowClosed((value) => !value)}
          >
            {showClosed ? "Show open" : "Show closed"}
          </Button>
          <ImportCases />
          <NewCaseDialog />
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          placeholder="Search by name"
          className="pl-9"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {cases.isPending ? (
        <div className="py-16 text-center">
          <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-muted-foreground">
            {search.trim()
              ? `Nothing matching "${search.trim()}".`
              : showClosed
                ? "Nothing closed yet."
                : "No open cases."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/cases/${row.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3.5 hover:border-[var(--accent)] transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium truncate">
                    {row.displayName}
                  </span>
                  <span className="block text-sm text-muted-foreground truncate">
                    {formatService(row.serviceAt)}
                    {row.nextOfKinName ? ` · ${row.nextOfKinName}` : ""}
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-3 text-sm">
                  {row.unreadFamilyMessages > 0 && (
                    <span
                      className="flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 text-white"
                      title="Messages waiting for a reply"
                    >
                      <MessageCircle className="size-3.5" />
                      {row.unreadFamilyMessages}
                    </span>
                  )}
                  {row.outstandingDeadlines > 0 && (
                    <span
                      className="flex items-center gap-1 text-muted-foreground"
                      title="Still outstanding with the family"
                    >
                      <TriangleAlert className="size-3.5" />
                      {row.outstandingDeadlines}
                    </span>
                  )}
                  <span
                    className="flex items-center gap-1 text-muted-foreground"
                    title="Photographs in"
                  >
                    <Images className="size-3.5" />
                    {row.photoCount}
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

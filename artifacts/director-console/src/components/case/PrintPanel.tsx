import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPrintTemplates,
  useGetPrintItems,
  useCreatePrintItem,
  useUpdatePrintItem,
  useDeletePrintItem,
  useGetSnippets,
  useGetCasePhotos,
  getGetPrintItemsQueryKey,
  type PrintItem,
  type PrintTemplate,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, MessageSquareWarning, Printer, Send, Trash2, Plus } from "lucide-react";
import { Loading } from "@/components/page";

/**
 * Where a piece stands, in the words a director would use on the phone.
 *
 * The family's answer is the part that used to be missing: a proof went
 * "with the family" and stayed there, because nothing they could do changed
 * it. Now it comes back approved (by whom) or with a change asked for.
 */
function statusLine(item: PrintItem): string {
  if (item.status === "approved") {
    if (!item.approvedByName) return "approved";
    return item.approvedByFamily
      ? `approved by ${item.approvedByName} (family)`
      : `approved by ${item.approvedByName}`;
  }
  if (item.changesRequestedAt) {
    return `${item.changesRequestedBy ?? "the family"} asked for a change`;
  }
  if (item.status === "proof" && item.sharedWithFamily) {
    return "with the family to check";
  }
  return "draft";
}

/** The family's note, set where the director will be making the change. */
function ChangesAsked({ item }: { item: PrintItem }) {
  if (!item.changesRequestedAt || !item.changesRequestedNote) return null;
  return (
    <div className="flex gap-3 rounded-lg border border-[var(--notice)]/30 bg-[var(--notice-soft)] p-3 text-sm">
      <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-[var(--notice)]" />
      <div className="min-w-0">
        <p className="font-medium">
          {item.changesRequestedBy ?? "The family"} asked for a change
        </p>
        <p className="mt-0.5 whitespace-pre-line text-muted-foreground">
          {item.changesRequestedNote}
        </p>
      </div>
    </div>
  );
}

/**
 * The print studio.
 *
 * What it replaces: a Word template somebody made in 2014, retyped at nine at
 * night for a service at eleven the next morning, printed twice because the
 * bleed was wrong.
 *
 * Point and click means exactly two decisions — which template, and what goes
 * in the slots. There is no canvas and nothing to drag, because a canvas is
 * how a name ends up 3mm into the fold and nobody notices until two hundred
 * are printed. The case already knows the name, the dates, the portrait and
 * the service details, so most slots arrive filled.
 *
 * Preview is the real thing: the same HTML the printer gets, in an iframe, so
 * what a director signs off is what comes back.
 */

function Studio({
  item,
  template,
  caseId,
  onDone,
}: {
  item: PrintItem;
  template: PrintTemplate;
  caseId: number;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const photos = useGetCasePhotos(caseId);
  const snippets = useGetSnippets();
  const [nonce, setNonce] = useState(0);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetPrintItemsQueryKey(caseId),
    });
    // Force the preview to re-fetch; its URL is otherwise unchanged.
    setNonce((value) => value + 1);
  };

  const update = useUpdatePrintItem({
    mutation: {
      meta: { handlesOwnErrors: true },
      onSuccess: refresh,
      onError: (error) =>
        toast({
          title: "That didn't save",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        }),
    },
  });

  // Signed off means frozen: the server refuses edits to an approved card's
  // wording or photograph, so the fields say so rather than failing on blur.
  const locked = item.status === "approved";
  const awaitingResend =
    item.status === "draft" && item.sharedWithFamily && item.changesRequestedAt !== null;

  const save = (values: Record<string, string>) =>
    update.mutate({ printItemId: item.id, data: { values } });

  const longSlots = template.slots.filter((slot) => slot.kind === "longText");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      {/* The preview is the same file the printer gets. */}
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border border-border bg-muted">
          <iframe
            key={nonce}
            title="Preview"
            src={`/api/print/${item.id}/render?v=${nonce}`}
            className="h-[34rem] w-full bg-white"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a
              href={`/api/print/${item.id}/render`}
              target="_blank"
              rel="noreferrer"
            >
              <Printer className="size-4" />
              Open to print
            </a>
          </Button>
          <span className="self-center text-sm text-muted-foreground">
            {template.width}″ × {template.height}″
            {template.perSheet > 1 && ` · ${template.perSheet} per sheet`}
          </span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <ChangesAsked item={item} />
        {locked && (
          <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            Approved{item.approvedByName ? ` by ${item.approvedByName}` : ""}, so the
            wording is set. Reopen it below to change anything.
          </p>
        )}
        {template.slots
          .filter((slot) => slot.kind === "photo")
          .map((slot) => (
            <div key={slot.key} className="space-y-1.5">
              <Label>{slot.label}</Label>
              <Select
                disabled={locked}
                value={item.photoId ? String(item.photoId) : "portrait"}
                onValueChange={(value) =>
                  update.mutate({
                    printItemId: item.id,
                    data: {
                      photoId: value === "portrait" ? null : Number(value),
                    },
                  })
                }
              >
                <SelectTrigger aria-label={slot.label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="portrait">The case portrait</SelectItem>
                  {(photos.data ?? [])
                    .filter((photo) => photo.status === "visible")
                    .map((photo) => (
                      <SelectItem key={photo.id} value={String(photo.id)}>
                        {photo.caption || `Photograph ${photo.id}`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ))}

        {template.slots
          .filter((slot) => slot.kind === "text")
          .map((slot) => (
            <div key={slot.key} className="space-y-1.5">
              <Label htmlFor={slot.key}>{slot.label}</Label>
              {slot.hint && (
                <p className="text-sm leading-snug text-muted-foreground">{slot.hint}</p>
              )}
              <Input
                id={slot.key}
                // Keyed on the saved value so a change from elsewhere (a
                // snippet, another tab) replaces what is shown, instead of
                // the stale text being saved back over it on the next blur.
                key={`${slot.key}:${item.values[slot.key] ?? ""}`}
                disabled={locked}
                defaultValue={item.values[slot.key] ?? ""}
                placeholder={item.resolved[slot.key] ?? ""}
                onBlur={(event) => {
                  const next = event.target.value;
                  if (next === (item.values[slot.key] ?? "")) return;
                  save({ [slot.key]: next });
                }}
              />
            </div>
          ))}

        {longSlots.map((slot) => (
          <div key={slot.key} className="space-y-1.5">
            <Label htmlFor={slot.key}>{slot.label}</Label>
            {slot.hint && (
              <p className="text-sm leading-snug text-muted-foreground">{slot.hint}</p>
            )}

            {/* Pick from the home's own list rather than retyping it. */}
            {(snippets.data ?? []).length > 0 && (
              <Select
                disabled={locked}
                value=""
                onValueChange={(value) => {
                  const snippet = (snippets.data ?? []).find(
                    (entry) => String(entry.id) === value,
                  );
                  if (snippet) save({ [slot.key]: snippet.body });
                }}
              >
                <SelectTrigger aria-label={`Use saved wording for ${slot.label}`}>
                  <SelectValue placeholder="Use one of ours…" />
                </SelectTrigger>
                <SelectContent>
                  {(snippets.data ?? []).map((snippet) => (
                    <SelectItem key={snippet.id} value={String(snippet.id)}>
                      {snippet.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Textarea
              id={slot.key}
              key={`${slot.key}:${item.values[slot.key] ?? ""}`}
              disabled={locked}
              rows={5}
              defaultValue={item.values[slot.key] ?? ""}
              placeholder={item.resolved[slot.key] ?? ""}
              onBlur={(event) => {
                const next = event.target.value;
                if (next === (item.values[slot.key] ?? "")) return;
                save({ [slot.key]: next });
              }}
            />
            {slot.maxLength && (
              <p className="text-sm leading-snug text-muted-foreground">
                Up to {slot.maxLength} characters fits.
              </p>
            )}
          </div>
        ))}

        <div className="space-y-1.5">
          <Label htmlFor="quantity">How many</Label>
          <Input
            id="quantity"
            type="number"
            min={1}
            key={`quantity:${item.quantity ?? ""}`}
            defaultValue={item.quantity ?? ""}
            onBlur={(event) => {
              const value = Number(event.target.value);
              const next = Number.isInteger(value) && value > 0 ? value : null;
              if (next === item.quantity) return;
              update.mutate({
                printItemId: item.id,
                data: { quantity: next },
              });
            }}
          />
        </div>

        {/*
          The single most common reprint is a misspelled name, and the only
          person who reliably catches that is the family.
        */}
        <label className="flex items-start gap-3 rounded-lg border border-border p-3">
          <Switch
            checked={item.sharedWithFamily}
            disabled={update.isPending}
            onCheckedChange={(checked) =>
              update.mutate({
                printItemId: item.id,
                data: {
                  sharedWithFamily: checked,
                  // Sharing a draft sends it as a proof; taking it back
                  // returns it to draft, so the list never says "with the
                  // family" about something they can no longer see.
                  ...(checked && item.status === "draft"
                    ? { status: "proof" as const }
                    : !checked && item.status === "proof"
                      ? { status: "draft" as const }
                      : {}),
                },
              })
            }
          />
          <span className="text-sm">
            <span className="block font-medium">Show the family a proof</span>
            <span className="block text-muted-foreground">
              Worth it for the spellings, especially names.
            </span>
          </span>
        </label>

        {awaitingResend && (
          <Button
            className="w-full"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({ printItemId: item.id, data: { status: "proof" } })
            }
          >
            <Send className="size-4" />
            Send the corrected proof
          </Button>
        )}

        <Button
          className="w-full"
          disabled={update.isPending}
          variant={item.status === "approved" || awaitingResend ? "secondary" : "default"}
          onClick={() =>
            update.mutate({
              printItemId: item.id,
              data: { status: item.status === "approved" ? "draft" : "approved" },
            })
          }
        >
          <Check className="size-4" />
          {item.status === "approved" ? "Approved — reopen" : "Approve for print"}
        </Button>
      </div>
    </div>
  );
}

export function PrintPanel({ caseId }: { caseId: number }) {
  const queryClient = useQueryClient();
  const templates = useGetPrintTemplates();
  const items = useGetPrintItems(caseId);
  const [editing, setEditing] = useState<number | null>(null);

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: getGetPrintItemsQueryKey(caseId),
    });

  const create = useCreatePrintItem({
    mutation: {
      onSuccess: (created) => {
        refresh();
        // Straight into the studio: starting one and then hunting for it in
        // a list is a wasted click at a bad moment.
        setEditing(created.id);
      },
    },
  });
  const remove = useDeletePrintItem({
    mutation: { onSuccess: () => { refresh(); setDeleting(null); } },
  });
  const [deleting, setDeleting] = useState<PrintItem | null>(null);

  if (templates.isPending || items.isPending) {
    return (
      <Loading />
    );
  }

  const open = (items.data ?? []).find((item) => item.id === editing);
  const openTemplate = (templates.data ?? []).find(
    (template) => template.key === open?.templateKey,
  );

  if (open && openTemplate) {
    return (
      <Studio
        item={open}
        template={openTemplate}
        caseId={caseId}
        onDone={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {(items.data ?? []).length > 0 && (
        <ul className="space-y-2">
          {items.data!.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 shadow-[var(--elevation-1)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {item.title ?? item.templateName}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {item.templateName}
                  {item.quantity ? ` · ${item.quantity} copies` : ""}
                  {` · ${statusLine(item)}`}
                </span>
              </span>

              <Button variant="outline" size="sm" onClick={() => setEditing(item.id)}>
                Open
              </Button>
              <Button asChild variant="ghost" size="sm">
                <a
                  href={`/api/print/${item.id}/render`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${item.title ?? item.templateName} to print`}
                >
                  <Printer className="size-4" />
                </a>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                aria-label={`Delete ${item.title ?? item.templateName}`}
                onClick={() => setDeleting(item)}
              >
                <Trash2 className="size-4" />
              </Button>
              {item.changesRequestedAt && (
                <div className="basis-full">
                  <ChangesAsked item={item} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-3">
        <h3 className="font-display text-base">Start something</h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {templates.data!.map((template) => (
            <li key={template.key}>
              <button
                type="button"
                disabled={create.isPending}
                className="w-full lift disabled:opacity-60 rounded-xl border border-border bg-card p-5 text-left shadow-[var(--elevation-1)] transition-gentle hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))]"
                onClick={() =>
                  create.mutate({ caseId, data: { templateKey: template.key } })
                }
              >
                <span className="flex items-center gap-2 font-medium">
                  <Plus className="size-4 text-[var(--accent-deep)]" />
                  {template.name}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {template.description}
                </span>
                <span className="mt-2 block text-xs text-muted-foreground">
                  {template.width}″ × {template.height}″
                  {template.perSheet > 1 && ` · ${template.perSheet} per sheet`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && !remove.isPending && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleting?.title ?? deleting?.templateName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.status === "approved"
                ? "This one has been approved. Deleting it removes the approval and the wording with it, and it can't be brought back."
                : "The wording and choices on it go with it, and it can't be brought back."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (deleting) remove.mutate({ printItemId: deleting.id });
              }}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

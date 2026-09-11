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
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, Printer, Trash2, Plus } from "lucide-react";

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
      onSuccess: refresh,
      onError: (error) =>
        toast({
          title: "That didn't fit",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        }),
    },
  });

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
        {template.slots
          .filter((slot) => slot.kind === "photo")
          .map((slot) => (
            <div key={slot.key} className="space-y-1.5">
              <Label>{slot.label}</Label>
              <Select
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
                <SelectTrigger>
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
                <p className="text-xs text-muted-foreground">{slot.hint}</p>
              )}
              <Input
                id={slot.key}
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
              <p className="text-xs text-muted-foreground">{slot.hint}</p>
            )}

            {/* Pick from the home's own list rather than retyping it. */}
            {(snippets.data ?? []).length > 0 && (
              <Select
                onValueChange={(value) => {
                  const snippet = (snippets.data ?? []).find(
                    (entry) => String(entry.id) === value,
                  );
                  if (snippet) save({ [slot.key]: snippet.body });
                }}
              >
                <SelectTrigger className="h-8">
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
              <p className="text-xs text-muted-foreground">
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
            defaultValue={item.quantity ?? ""}
            onBlur={(event) => {
              const value = Number(event.target.value);
              update.mutate({
                printItemId: item.id,
                data: { quantity: Number.isInteger(value) && value > 0 ? value : null },
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
            onCheckedChange={(checked) =>
              update.mutate({
                printItemId: item.id,
                data: {
                  sharedWithFamily: checked,
                  ...(checked && item.status === "draft"
                    ? { status: "proof" as const }
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

        <Button
          className="w-full"
          variant={item.status === "approved" ? "secondary" : "default"}
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
  const remove = useDeletePrintItem({ mutation: { onSuccess: refresh } });

  if (templates.isPending || items.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
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
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {item.title ?? item.templateName}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {item.templateName}
                  {item.quantity ? ` · ${item.quantity} copies` : ""}
                  {item.status === "approved"
                    ? " · approved"
                    : item.sharedWithFamily
                      ? " · with the family"
                      : " · draft"}
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
                >
                  <Printer className="size-4" />
                </a>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                aria-label={`Delete ${item.templateName}`}
                onClick={() => remove.mutate({ printItemId: item.id })}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-3">
        <h3 className="font-medium">Start something</h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {templates.data!.map((template) => (
            <li key={template.key}>
              <button
                type="button"
                className="w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-[var(--accent)]"
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
    </div>
  );
}

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  catalogueQueryKey,
  previewCatalogueImport,
  runCatalogueImport,
  formatPrice,
  SECTION_LABELS,
  type CatalogueImportPreview,
  type CatalogueSection,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, TriangleAlert } from "lucide-react";

/**
 * Loading the price sheet the home already has.
 *
 * This is the feature that decides whether a home ever uses the storefront.
 * The alternative is typing two hundred caskets into a web form, and a
 * director who is asked to do that does something else instead — so the
 * import comes first and the hand-entry form is what you use afterwards to
 * fix one row.
 *
 * Preview before commit, like the case importer, and for a sharper reason:
 * the number in the wrong column here is a price a family is shown. The one
 * decision the director has to make is which of their own category names are
 * caskets, because that is what decides which statutory price list each
 * appears on, and guessing it wrong puts a vault on the Casket Price List.
 */

const SECTION_CHOICES: { value: CatalogueSection; label: string; hint: string }[] =
  [
    { value: "services", label: SECTION_LABELS.services, hint: "General Price List" },
    {
      value: "caskets",
      label: SECTION_LABELS.caskets,
      hint: "General Price List and Casket Price List",
    },
    {
      value: "outer_burial_containers",
      label: SECTION_LABELS.outer_burial_containers,
      hint: "General Price List and Outer Burial Container Price List",
    },
    {
      value: "merchandise",
      label: SECTION_LABELS.merchandise,
      hint: "General Price List",
    },
    {
      value: "cash_advance",
      label: SECTION_LABELS.cash_advance,
      hint: "General Price List, disclosed separately",
    },
  ];

export function ImportCatalogue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CatalogueImportPreview | null>(null);
  const [sections, setSections] = useState<Record<string, CatalogueSection>>({});
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setSections({});
    if (fileInput.current) fileInput.current.value = "";
  };

  async function choose(chosen: File | null) {
    if (!chosen) return;
    setFile(chosen);
    setBusy(true);

    try {
      const result = await previewCatalogueImport(chosen);
      setPreview(result);
      setSections(
        Object.fromEntries(result.categories.map((row) => [row.name, row.section])),
      );
    } catch (error) {
      toast({
        title: "Couldn't read that file",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!file) return;
    setBusy(true);

    try {
      const result = await runCatalogueImport(file, sections);

      void queryClient.invalidateQueries({ queryKey: catalogueQueryKey });

      toast({
        title:
          result.updated > 0 && result.created > 0
            ? `${result.created} added, ${result.updated} updated`
            : result.updated > 0
              ? `${result.updated} price${result.updated === 1 ? "" : "s"} updated`
              : `${result.created} item${result.created === 1 ? "" : "s"} added`,
        description:
          result.issues.length > 0
            ? `${result.issues.length} row${result.issues.length === 1 ? "" : "s"} needed looking at and were left out.`
            : undefined,
      });

      setOpen(false);
      reset();
    } catch (error) {
      toast({
        title: "The import failed",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="size-4" />
        Load a price sheet
      </Button>

      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {preview ? "Check this before it goes in" : "Load your price sheet"}
          </DialogTitle>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A CSV of your own merchandise and prices — whatever your supplier
              or your selection room already produces. We'll work out the
              columns and show you what would be loaded before anything is
              saved.
            </p>
            <p className="text-sm text-muted-foreground">
              It needs a name column and a price column. Anything labelled cost
              or wholesale is ignored on purpose, so your margin never lands on
              a sheet a family reads.
            </p>

            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => void choose(event.target.files?.[0] ?? null)}
            />

            <Button
              className="w-full"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Choose a CSV
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-sm">
              <strong>{preview.wouldCreate}</strong> item
              {preview.wouldCreate === 1 ? "" : "s"} would be added
              {preview.wouldUpdate > 0 && (
                <>
                  , and <strong>{preview.wouldUpdate}</strong> already here
                  would have {preview.wouldUpdate === 1 ? "its" : "their"} price
                  updated
                </>
              )}
              .
            </p>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">
                Which price list is each of these on?
              </h3>
              <p className="text-sm text-muted-foreground">
                We've guessed from the names. Caskets and outer burial
                containers get their own lists, and a family is shown neither
                until they have your General Price List.
              </p>

              <ul className="space-y-2">
                {preview.categories.map((entry) => (
                  <li key={entry.name} className="flex flex-wrap items-center gap-3">
                    <span className="min-w-40 flex-1 text-sm">
                      {entry.name}
                      <span className="ml-2 text-muted-foreground">
                        {entry.itemCount} item{entry.itemCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <Select
                      value={sections[entry.name] ?? entry.section}
                      onValueChange={(value) =>
                        setSections((current) => ({
                          ...current,
                          [entry.name]: value as CatalogueSection,
                        }))
                      }
                    >
                      <SelectTrigger className="w-72">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SECTION_CHOICES.map((choice) => (
                          <SelectItem key={choice.value} value={choice.value}>
                            {choice.label} — {choice.hint}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                ))}
              </ul>
            </section>

            {preview.issues.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-border bg-card p-3 text-sm">
                {preview.issues.slice(0, 8).map((issue) => (
                  <li
                    key={`${issue.row}-${issue.message}`}
                    className="flex gap-2 text-muted-foreground"
                  >
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Row {issue.row}: {issue.message}
                    </span>
                  </li>
                ))}
                {preview.issues.length > 8 && (
                  <li className="text-muted-foreground">
                    …and {preview.issues.length - 8} more.
                  </li>
                )}
              </ul>
            )}

            <div className="max-h-64 overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 text-right font-medium">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.row} className="border-t border-border">
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.categoryName}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatPrice(row.priceCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset} disabled={busy}>
                Choose a different file
              </Button>
              <Button onClick={() => void confirm()} disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Load these prices
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

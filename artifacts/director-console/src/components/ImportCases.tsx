import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCasesQueryKey,
  type ImportPreview,
  type ImportResult,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, TriangleAlert, Check } from "lucide-react";

/**
 * Bringing in a case list from whatever the home already runs.
 *
 * Preview first, always. The failure mode of a bad import is two hundred
 * wrong cases and no undo, so the director sees the guessed column mapping
 * and the first rows before anything is written — long enough to notice that
 * the dates parsed and the names are in the right columns.
 *
 * Uploaded with a plain FormData post rather than the generated client: the
 * body is a file, and the browser has to set its own multipart boundary.
 */
async function postCsv<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch(path, {
    method: "POST",
    body,
    credentials: "include",
  });

  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "That file could not be read.");
  }

  return payload;
}

export function ImportCases() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  async function choose(chosen: File | null) {
    if (!chosen) return;
    setFile(chosen);
    setBusy(true);

    try {
      setPreview(
        await postCsv<ImportPreview>("/api/cases/import/preview", chosen),
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
      const result = await postCsv<ImportResult>("/api/cases/import", file);

      void queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });

      toast({
        title: `${result.created} case${result.created === 1 ? "" : "s"} imported`,
        description:
          result.skipped > 0
            ? `${result.skipped} already open here and were left alone.`
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
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="size-4" />
          Import
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import cases</DialogTitle>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A CSV exported from whatever you already use. We'll work out the
              columns and show you what would be created before anything is
              written.
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
          <div className="space-y-4">
            <p className="text-sm">
              <strong>{preview.wouldCreate}</strong> case
              {preview.wouldCreate === 1 ? "" : "s"} would be created
              {preview.wouldSkip > 0 && (
                <>
                  , <strong>{preview.wouldSkip}</strong> already open here and
                  would be left alone
                </>
              )}
              .
            </p>

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
                <thead className="sticky top-0 bg-card">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Service</th>
                    <th className="px-3 py-2 font-medium">Next of kin</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.row} className="border-t border-border">
                      <td className="px-3 py-2">
                        {row.decedentName}
                        {row.duplicate && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            already open
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.serviceAt
                          ? new Date(row.serviceAt).toLocaleString(undefined, {
                              day: "numeric",
                              month: "short",
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.contactName ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.unmapped.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Columns we didn't recognise and ignored:{" "}
                {preview.unmapped.join(", ")}.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Families are not contacted by importing. You send each link when
              you're ready.
            </p>

            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={busy || preview.wouldCreate === 0}
                onClick={() => void confirm()}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Import {preview.wouldCreate}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={reset}>
                Choose another file
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

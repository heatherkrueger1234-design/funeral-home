import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSnippets,
  useCreateSnippet,
  useUpdateSnippet,
  useArchiveSnippet,
  getGetSnippetsQueryKey,
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
import { Loader2, Plus, X } from "lucide-react";

/**
 * The home's own verses, prayers and closing lines.
 *
 * Deliberately empty to start with. Nothing is shipped here, for two reasons
 * worth being straight about with the director: most of what goes on a
 * prayer card is somebody's copyright and it is not ours to distribute — and
 * a home already has this list. It is in a Word file every director copies
 * from, and it reflects that home's community, its denominations and the
 * three readings the local priest always uses. A generic list would be worse
 * than the one they have.
 *
 * So this is somewhere to put that file, once, so it stops being copied and
 * pasted.
 */

const KINDS = [
  { value: "verse", label: "Verse" },
  { value: "prayer", label: "Prayer" },
  { value: "poem", label: "Poem" },
  { value: "reading", label: "Reading" },
  { value: "closing", label: "Closing line" },
  { value: "hymn", label: "Hymn" },
];

export function SnippetLibrary({ readOnly }: { readOnly: boolean }) {
  const queryClient = useQueryClient();
  const snippets = useGetSnippets();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("verse");

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getGetSnippetsQueryKey() });

  const add = useCreateSnippet({
    mutation: {
      onSuccess: () => {
        setTitle("");
        setBody("");
        refresh();
      },
    },
  });
  const update = useUpdateSnippet({ mutation: { onSuccess: refresh } });
  const remove = useArchiveSnippet({ mutation: { onSuccess: refresh } });

  const rows = snippets.data ?? [];

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="font-medium">Your verses and readings</h2>
        <p className="text-sm text-muted-foreground">
          What you print on cards and programs. Add them once and pick from
          them in the print studio, instead of copying from a Word file.
        </p>
      </div>

      {snippets.isPending ? (
        <div className="py-6 text-center">
          <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          Nothing here yet. We don't ship any — most of what goes on a prayer
          card belongs to somebody, and your own list is better than a generic
          one anyway.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((snippet) => (
            <li
              key={snippet.id}
              className="rounded-lg border border-border p-3"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{snippet.title}</p>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {snippet.body.length > 180
                      ? `${snippet.body.slice(0, 180)}…`
                      : snippet.body}
                  </p>
                  {snippet.attribution && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      — {snippet.attribution}
                    </p>
                  )}
                </div>

                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground"
                    aria-label={`Remove ${snippet.title}`}
                    onClick={() => remove.mutate({ snippetId: snippet.id })}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>

              {/*
                The home says whether it is theirs to print. We cannot know,
                and pretending to would be worse than asking.
              */}
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={snippet.clearedForPrint}
                  disabled={readOnly}
                  onCheckedChange={(checked) =>
                    update.mutate({
                      snippetId: snippet.id,
                      data: {
                        title: snippet.title,
                        body: snippet.body,
                        clearedForPrint: checked,
                      },
                    })
                  }
                />
                We have the right to print this
              </label>
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <form
          className="space-y-3 border-t border-border pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate({
              data: {
                kind: kind as "verse",
                title: title.trim(),
                body: body.trim(),
              },
            });
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-[9rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              value={title}
              placeholder="What you call it"
              className="min-w-[10rem] flex-1"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="snippetBody" className="sr-only">
              The text
            </Label>
            <Textarea
              id="snippetBody"
              rows={4}
              value={body}
              placeholder="Paste the text here."
              onChange={(event) => setBody(event.target.value)}
            />
          </div>

          <Button
            type="submit"
            variant="outline"
            disabled={!title.trim() || !body.trim()}
          >
            <Plus className="size-4" />
            Add
          </Button>
        </form>
      )}
    </section>
  );
}

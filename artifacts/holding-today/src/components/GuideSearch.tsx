import { useState } from "react";
import { Link } from "wouter";
import { Search, Loader2 } from "lucide-react";
import { searchGuides, type GuideSearchResult } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CrisisLine } from "@/components/CrisisHelp";
import { ALL_CHAPTERS } from "@/content/index";

/**
 * Asking the guides a question.
 *
 * The server returns chapter ids and nothing else — every word the reader then
 * sees was written by a person. This component looks those ids up in the
 * content it already has and links to them; there is no path by which
 * generated prose reaches the page.
 *
 * If the question was itself somebody in trouble, the numbers come up instead
 * of a reading list. That is the one query where a set of search results would
 * be the wrong answer.
 */
export function GuideSearch() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GuideSearchResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      setResult(await searchGuides({ query: query.trim() }));
    } catch {
      // A search that fails should not be an error box on top of everything
      // else. The chapters are all still on the page below.
      setResult({ crisis: false, usedModel: false, chapterIds: [] });
    } finally {
      setBusy(false);
    }
  };

  const found = (result?.chapterIds ?? [])
    .map((id) => ALL_CHAPTERS.find((c) => c.id === id))
    .filter((c): c is (typeof ALL_CHAPTERS)[number] => Boolean(c));

  return (
    <section className="mb-8" aria-label="Search the guides">
      <form onSubmit={run} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask it plainly — “can I still see him after an autopsy”"
            className="bg-background border-white/10 pl-10"
          />
        </div>
        <Button
          type="submit"
          disabled={busy || !query.trim()}
          className="bg-primary text-primary-foreground"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Find it"}
        </Button>
      </form>

      {result?.crisis && (
        <div className="mt-5">
          <p className="text-foreground/90 leading-relaxed mb-4">
            That sounded less like a question about the guides and more like
            tonight. This first, and the reading can wait.
          </p>
          <CrisisLine />
        </div>
      )}

      {result && !result.crisis && (
        <div className="mt-5">
          {found.length === 0 ? (
            <p className="text-muted-foreground leading-relaxed">
              Nothing matched that. Try fewer words, or the word somebody would
              actually use — “autopsy”, “cremation”, “bills”, “work”.
            </p>
          ) : (
            <div className="space-y-2">
              {found.map((chapter) => (
                <Link
                  key={chapter.id}
                  href={`${chapter.page}#${chapter.id}`}
                  className="block rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 hover:bg-white/[0.07] transition-colors"
                >
                  <p className="text-foreground font-medium">{chapter.title}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed mt-0.5">
                    {chapter.summary}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

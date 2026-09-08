import { Router, type IRouter } from "express";
import { SearchGuidesBody } from "@workspace/api-zod";
import { badRequest, parseBody } from "../lib/http";
import { GUIDE_CHAPTERS } from "../lib/guide-index";
import { checkForCrisis } from "../lib/crisis-check";
import { logger } from "../lib/logger";

/**
 * Finding the chapter that answers a question.
 *
 * Public, like the guides themselves: the parent standing in a hospital
 * corridor who needs the chapter on viewing a body is not going to register
 * for anything first, and a search over public pages leaks nothing.
 *
 * Two rules make this safe enough to put in front of the bereaved.
 *
 * **It returns chapter ids, never prose.** The model's only job is to say
 * which of a fixed list of chapters is relevant. Every word the reader then
 * sees was written by a person and, for the medical chapters, reviewed by one.
 * A model that answered "can I bury him on my land" directly would be
 * confidently wrong about a county it has never heard of, and the entire
 * `law`-block design exists to prevent exactly that.
 *
 * **Keywords always work.** The model is an improvement on the ranking, not a
 * dependency. With no key configured, a rate limit, an outage or a timeout,
 * the search still returns sensible chapters — it must never be the case that
 * someone in the first week gets an error instead of the autopsy chapter.
 */

const MODEL = "gpt-4o-mini";
const MODEL_TIMEOUT_MS = 4000;
const MAX_RESULTS = 6;

/** Words too common in this corpus to distinguish one chapter from another. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "is", "it", "for", "on",
  "my", "our", "their", "his", "her", "them", "they", "i", "we", "you",
  "what", "when", "how", "do", "does", "did", "can", "should", "am", "are",
  "was", "were", "be", "been", "with", "about", "after", "before", "that",
  "this", "have", "has", "had", "will", "would", "if", "at", "by", "from",
  "died", "death", "dead", "grief", "loss",
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * Keyword ranking. Crude, deterministic and always available.
 *
 * A title hit is worth more than a summary hit, and a prefix match counts so
 * that "cremate" finds "cremation" without needing a stemmer.
 */
function keywordRank(query: string): string[] {
  const terms = tokenise(query);
  if (terms.length === 0) return [];

  const scored = GUIDE_CHAPTERS.map((chapter) => {
    const title = chapter.title.toLowerCase();
    const summary = chapter.summary.toLowerCase();
    let score = 0;

    for (const term of terms) {
      if (title.includes(term)) score += 3;
      else if (new RegExp(`\\b${term.slice(0, 4)}`).test(title)) score += 2;
      if (summary.includes(term)) score += 2;
      else if (new RegExp(`\\b${term.slice(0, 4)}`).test(summary)) score += 1;
      if (chapter.id.includes(term)) score += 2;
    }

    return { id: chapter.id, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.id);
}

/**
 * Asks the model to pick from the list. Returns null on anything at all going
 * wrong, and the caller falls back to keywords.
 */
async function modelRank(query: string): Promise<string[] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const catalogue = GUIDE_CHAPTERS.map(
    (c) => `${c.id}: ${c.title} — ${c.summary}`,
  ).join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You route questions from bereaved people to chapters of a guide. " +
              "You are given a fixed catalogue of chapters. Reply with JSON: " +
              '{"chapterIds": ["id", ...]}, at most 6, most relevant first, ' +
              "using only ids from the catalogue. Never invent an id. " +
              "Never write advice, explanation or commentary of any kind — " +
              "your entire output is the id list. If nothing in the catalogue " +
              "is relevant, reply with an empty list.\n\n" +
              `Catalogue:\n${catalogue}`,
          },
          { role: "user", content: query.slice(0, 500) },
        ],
      }),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, "guide search: model call failed");
      return null;
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as { chapterIds?: unknown };
    if (!Array.isArray(parsed.chapterIds)) return null;

    // Anything the model invented is discarded rather than trusted. The
    // catalogue is the authority on what exists.
    const known = new Set(GUIDE_CHAPTERS.map((c) => c.id));
    const ids = parsed.chapterIds
      .filter((id): id is string => typeof id === "string" && known.has(id))
      .slice(0, MAX_RESULTS);

    return ids.length > 0 ? ids : null;
  } catch (error) {
    logger.warn({ err: error }, "guide search: falling back to keywords");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const router: IRouter = Router();

router.post("/guides/search", async (req, res) => {
  const { query } = parseBody(SearchGuidesBody, req.body);
  const trimmed = query.trim();
  if (!trimmed) throw badRequest("Type something to search for.");

  // A question that is itself a person in trouble is not a search. Answering
  // it with a reading list would be the wrong response to the only message
  // here that genuinely cannot wait.
  const crisis = checkForCrisis(trimmed);
  if (crisis.matched) {
    res.json({ crisis: true, usedModel: false, chapterIds: ["not-wanting-to-be-here"] });
    return;
  }

  const fromModel = await modelRank(trimmed);
  const chapterIds = fromModel ?? keywordRank(trimmed);

  res.json({ crisis: false, usedModel: fromModel !== null, chapterIds });
});

export default router;

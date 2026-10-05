import Anthropic from "@anthropic-ai/sdk";
import type { ObituaryFields } from "./obituary";

/**
 * An optional suggested rewrite of the obituary, for the director only.
 *
 * Off unless `ANTHROPIC_API_KEY` is set. Nothing is sent until a director asks
 * for a suggestion and confirms that the family's words will go to the
 * provider; the answer is stored beside the draft, never over it, and never
 * shown to the family or printed unless the director takes it. The composed
 * draft in `obituary.ts` stays the default because it invents nothing.
 */

export const OBITUARY_AI_MODEL =
  process.env["OBITUARY_AI_MODEL"]?.trim() || "claude-opus-5-5";

export function isObituaryAiConfigured(): boolean {
  return Boolean(process.env["ANTHROPIC_API_KEY"]?.trim());
}

export class ObituaryAiError extends Error {
  readonly name = "ObituaryAiError";
}

const SYSTEM =
  "You help a funeral director turn a family's notes into a short, dignified " +
  "newspaper obituary. Use only the facts given. Never add a fact, a " +
  "relationship, a cause of death, a date, a place, a job, a faith or a " +
  "sentiment that is not in the notes. Keep every name exactly as spelled. " +
  "Keep the family's own words where you can, especially in the life story. " +
  "Use the pronoun given; if none is given, use the person's first name. " +
  "Plain prose in paragraphs, no headings, no markdown, no quotation marks " +
  "around the whole text. Reply with the obituary text only.";

/*
 * What is sent is capped, because it is paid for by the token. A family's
 * life story runs to a few thousand characters; the fields themselves take
 * up to the request size, and a 600 KB "biography" would otherwise bill
 * about 150,000 tokens to the platform's key on every press.
 */
const FIELD_LIMIT = 8_000;
const NOTES_LIMIT = 20_000;

function notes(fields: ObituaryFields): string {
  const line = (label: string, value: string | null | undefined) =>
    value?.trim() ? `${label}: ${value.trim().slice(0, FIELD_LIMIT)}` : null;
  return [
    line("Full name", fields.fullName),
    line("Pronoun", fields.pronouns),
    line("Born (date)", fields.bornOn),
    line("Born (place)", fields.birthPlace),
    line("Died (date)", fields.diedOn),
    line("Died (place)", fields.deathPlace),
    line("Their life, in the family's words", fields.biography),
    line("Preceded in death by", fields.precededBy),
    line("Survived by", fields.survivedBy),
    line("The family wishes to thank", fields.specialThanks),
    line("In lieu of flowers", fields.inLieuOfFlowers),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, NOTES_LIMIT);
}

/** Ask for one suggested rewrite. Throws `ObituaryAiError` with a sentence a director can read. */
export async function suggestObituary(fields: ObituaryFields): Promise<string> {
  if (!isObituaryAiConfigured()) {
    throw new ObituaryAiError("Suggested drafts are not switched on for this deployment.");
  }
  const facts = notes(fields);
  if (!facts) throw new ObituaryAiError("There is nothing in the obituary to work from yet.");

  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });

  try {
    const response = await client.messages.create({
      model: OBITUARY_AI_MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: facts }],
    });

    if (response.stop_reason === "refusal") {
      throw new ObituaryAiError("No suggestion could be made for this one. The composed draft is unchanged.");
    }

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    if (!text) throw new ObituaryAiError("The suggestion came back empty. Please try again.");
    return text;
  } catch (error) {
    if (error instanceof ObituaryAiError) throw error;
    if (error instanceof Anthropic.RateLimitError) {
      throw new ObituaryAiError("Too many suggestions at once. Please try again in a minute.");
    }
    if (error instanceof Anthropic.APIError) {
      throw new ObituaryAiError(`The suggestion service refused (${error.status ?? "no status"}).`);
    }
    throw new ObituaryAiError("The suggestion service could not be reached.");
  }
}

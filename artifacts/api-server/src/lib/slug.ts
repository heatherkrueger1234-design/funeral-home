import { eq } from "drizzle-orm";
import { db, funeralHomesTable } from "@workspace/db";
import { HttpError } from "./http";

/**
 * A URL slug from the home's name, made unique by suffixing.
 *
 * Shared by self-serve signup (`auth/register`) and the platform console's
 * "create a home", so the two cannot drift into slugging names differently.
 *
 * The suffix loop is bounded rather than a `while (true)`: two homes called
 * "Green Lawn" is ordinary, two hundred is a bug or an attack, and either
 * way it should fail loudly instead of spinning.
 */
export async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "home";

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: funeralHomesTable.id })
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.slug, candidate))
      .limit(1);

    if (!taken) return candidate;
  }

  throw new HttpError(500, "Could not allocate a unique name for this home");
}

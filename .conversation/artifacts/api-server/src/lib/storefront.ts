import { and, asc, eq } from "drizzle-orm";
import {
  db,
  homePoliciesTable,
  toPublicFuneralHome,
  toPublicHomePolicy,
  DEFAULT_POLICY_PROMPTS,
  type FuneralHome,
  type PublicFuneralHome,
  type PublicHomePolicy,
} from "@workspace/db";

/**
 * The home as anyone outside the office may see it.
 *
 * One function for both audiences — the stranger on the public page and the
 * family inside the portal — because they are shown the same thing, and two
 * functions is how they stop being the same thing. The important property is
 * negative: what this returns is built from `toPublicFuneralHome` and the
 * *published* policy rows, and it is the only place where the home's own
 * record is narrowed for an outside reader. Nothing about the account,
 * nothing about drafts, and nothing about prices.
 */

export type PublicHomeWithPolicies = PublicFuneralHome & {
  policies: PublicHomePolicy[];
};

export async function publishedPolicies(
  funeralHomeId: number,
): Promise<PublicHomePolicy[]> {
  const rows = await db
    .select()
    .from(homePoliciesTable)
    .where(
      and(
        eq(homePoliciesTable.funeralHomeId, funeralHomeId),
        eq(homePoliciesTable.published, true),
      ),
    )
    .orderBy(asc(homePoliciesTable.position), asc(homePoliciesTable.id));

  return rows.map(toPublicHomePolicy);
}

export async function publicHome(
  home: FuneralHome,
): Promise<PublicHomeWithPolicies> {
  return {
    ...toPublicFuneralHome(home),
    policies: await publishedPolicies(home.id),
  };
}

/**
 * Give a newly registered home the headings of the conversation it is
 * already having, unpublished.
 *
 * Unpublished matters more than the wording does. A home must never discover
 * that this product put a sentence about their deposits on the internet under
 * their name — so what is seeded is a prompt in the body text, visible only
 * to staff, which reads as an instruction rather than as policy. What the
 * seeding buys is a director opening the page and recognising the list,
 * instead of facing an empty screen and a button marked "Add section".
 */
export async function seedPolicyPrompts(
  funeralHomeId: number,
  tx: Pick<typeof db, "insert"> = db,
): Promise<void> {
  await tx.insert(homePoliciesTable).values(
    DEFAULT_POLICY_PROMPTS.map((entry, position) => ({
      funeralHomeId,
      title: entry.title,
      body: entry.body,
      published: false,
      position,
    })),
  );
}

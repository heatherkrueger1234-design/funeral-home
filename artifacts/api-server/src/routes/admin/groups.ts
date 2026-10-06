import {
  ADD_ONS,
  db,
  freeTrialEndsAt,
  funeralHomesTable,
  hasLiveSubscription,
  homeGroupsTable,
  isAddOnKey,
  type AddOnKey,
  type HomeGroup,
} from "@workspace/db";
import { asc, count, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  createGroupCheckoutSession,
  isBillingConfigured,
  syncGroupSeats,
} from "../../lib/billing";
import {
  badRequest,
  HttpError,
  parseBody,
  parseId,
  requireRow,
} from "../../lib/http";
import {
  actor,
  PlatformActor,
  platformFindHomeForChange,
  recordPlatformAccess,
  toAdminHome,
} from "./shared";

/** Groups: several locations on one contract. */
const router: IRouter = Router();

/* ------------------------------------------------------------- groups -- */

/**
 * Funeral-home groups: one contract, many locations.
 *
 * This lives in the platform console rather than in any home's own console,
 * and that is the right place for it. A group contract is negotiated by a
 * person at this end talking to a person who owns forty funeral homes; it is
 * not something a director at one branch should be able to create by
 * clicking about in their settings.
 *
 * Every route here audits, like everything else under `/admin`, though these
 * read less than the rest of the console does: a group row holds a name, a
 * Stripe id and a status, and no family has ever appeared in one.
 */

/** How long a location gets to arrange its own billing after leaving a group. */
const GROUP_EXIT_GRACE_DAYS = 14;

/**
 * Tell Stripe how many locations each group a move touched now has, and
 * say, in words for whoever made the move, anything it could not be told.
 */
async function matchGroupBills(
  groupIds: Array<number | null>,
): Promise<string | undefined> {
  const problems: string[] = [];

  for (const groupId of new Set(groupIds)) {
    if (groupId === null) continue;
    const outcome = await syncGroupSeats(groupId);
    if (outcome && !outcome.synced) {
      problems.push(
        `Stripe could not be told that ${outcome.groupName} now has ` +
          `${outcome.locations} location${outcome.locations === 1 ? "" : "s"} ` +
          `(${outcome.reason}). Set that quantity on its subscription in Stripe.`,
      );
    }
  }

  return problems.length > 0 ? problems.join(" ") : undefined;
}

async function uniqueGroupSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "group";

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: homeGroupsTable.id })
      .from(homeGroupsTable)
      .where(eq(homeGroupsTable.slug, candidate))
      .limit(1);

    if (!taken) return candidate;
  }

  throw new HttpError(500, "Could not allocate a unique name for this group.");
}

/**
 * A group as the console sees it. Hand-built for the same reason
 * `toAdminHome` is: a column added to `home_groups` should not widen this
 * by accident.
 */
function toAdminGroup(group: HomeGroup, locations: number) {
  return {
    id: group.id,
    name: group.name,
    slug: group.slug,
    locations,
    subscriptionStatus: group.subscriptionStatus,
    trialEndsAt: group.trialEndsAt,
    currentPeriodEndsAt: group.currentPeriodEndsAt,
    hasSubscription: hasLiveSubscription(group),
    entitlements: group.entitlements
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    createdAt: group.createdAt,
  };
}

async function locationCounts(
  groupIds: number[],
): Promise<Map<number, number>> {
  if (groupIds.length === 0) return new Map();

  const rows = await db
    .select({ groupId: funeralHomesTable.groupId, total: count() })
    .from(funeralHomesTable)
    .where(inArray(funeralHomesTable.groupId, groupIds))
    .groupBy(funeralHomesTable.groupId);

  return new Map(
    rows.flatMap((row) =>
      row.groupId === null ? [] : [[row.groupId, row.total]],
    ),
  );
}

router.get("/admin/groups", async (req, res) => {
  const who = actor(req);
  await recordPlatformAccess(who, "group.list", null);

  const groups = await db
    .select()
    .from(homeGroupsTable)
    .orderBy(asc(homeGroupsTable.name));

  const counts = await locationCounts(groups.map((group) => group.id));

  res.json(
    groups.map((group) => toAdminGroup(group, counts.get(group.id) ?? 0)),
  );
});

const CreateGroupBody = z.object({
  name: z.string().trim().min(1).max(160),
});

router.post("/admin/groups", async (req, res) => {
  const who = actor(req);
  const { name } = parseBody(CreateGroupBody, req.body);

  const [created] = await db
    .insert(homeGroupsTable)
    .values({
      name,
      slug: await uniqueGroupSlug(name),
      // A group starts on the same trial a single home gets. Nobody signs a
      // forty-location contract without trying it on one of them first.
      trialEndsAt: freeTrialEndsAt(),
    })
    .returning();

  await recordPlatformAccess(
    who,
    "group.create",
    null,
    `Created group "${name}"`,
  );

  res.status(201).json(toAdminGroup(created!, 0));
});

async function loadGroup(who: PlatformActor, raw: string | undefined) {
  const [group] = await db
    .select()
    .from(homeGroupsTable)
    .where(eq(homeGroupsTable.id, parseId(raw)))
    .limit(1);

  const row = requireRow(group, "That group could not be found.");
  await recordPlatformAccess(
    who,
    "group.open",
    null,
    `Opened group "${row.name}"`,
  );
  return row;
}

router.get("/admin/groups/:groupId", async (req, res) => {
  const who = actor(req);
  const group = await loadGroup(who, req.params.groupId);

  const locations = await db
    .select()
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.groupId, group.id))
    .orderBy(asc(funeralHomesTable.name));

  res.json({
    // `locations` below replaces the summary's count with the list itself;
    // the console reads the count from its length.
    ...toAdminGroup(group, locations.length),
    // Whether "start the contract" can work here at all, so the console can
    // say so before somebody fills in the form rather than after.
    billingConfigured: isBillingConfigured(),
    addOns: ADD_ONS.map((addOn) => ({
      key: addOn.key,
      title: addOn.title,
      detail: addOn.detail,
      included: group.entitlements.split(",").includes(addOn.key),
    })),
    locations: locations.map(toAdminHome),
  });
});

const MoveHomeBody = z.object({
  /** Null takes the location back out of its group. */
  groupId: z.number().int().positive().nullable(),
});

/**
 * Move a location into a group, or out of one.
 *
 * Both directions have a trap, and both are handled here rather than left to
 * whoever is on the call with the customer.
 *
 * **In:** a home that already has its own Stripe subscription is refused.
 * Letting it join would leave the group paying a consolidated invoice while
 * the branch quietly kept paying its own, and that is discovered by somebody
 * in accounts a quarter later, which is the worst possible way for a vendor
 * to be wrong about money.
 *
 * **Out:** the location keeps working. A branch sold to an independent owner
 * on Tuesday has funerals on Wednesday, and cutting it off the moment the
 * paperwork changed would stop a family part-way through uploading
 * photographs of their mother because two companies were renegotiating. It
 * gets a fortnight to put its own card in, on a trial with a real end date.
 */
router.put("/admin/homes/:homeId/group", async (req, res) => {
  const who = actor(req);
  const { groupId } = parseBody(MoveHomeBody, req.body);

  // The group first, so the log line can name it -- "moved into group 3" is
  // a line nobody can read in a year -- and so a group that does not exist is
  // refused before a line is written saying something happened. A group row
  // holds no tenant's data (see the section comment), so this read needs no
  // audit of its own.
  const [group] =
    groupId === null
      ? []
      : await db
          .select()
          .from(homeGroupsTable)
          .where(eq(homeGroupsTable.id, groupId))
          .limit(1);

  const target =
    groupId === null
      ? null
      : requireRow(group, "That group could not be found.");

  // Found here and logged below, once the move has passed its checks -- see
  // `platformFindHomeForChange` for why a refused move must not leave a line
  // saying it happened.
  const home = await platformFindHomeForChange(parseId(req.params.homeId));

  if (target === null) {
    // Only a location that is actually in a group can leave one. Without this
    // an independent, paying home sent here was quietly put back on a
    // fortnight's trial with its add-ons stripped.
    if (home.groupId === null) {
      throw badRequest("This home is not part of a group.");
    }

    await recordPlatformAccess(
      who,
      "home.group.update",
      home,
      "Removed from its group",
    );

    const graceEnds = new Date(
      Date.now() + GROUP_EXIT_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );

    const [updated] = await db
      .update(funeralHomesTable)
      .set({
        groupId: null,
        subscriptionStatus: "trial",
        trialEndsAt: graceEnds,
        // A new trial with a real end, so its reminders are owed again. Left
        // as they were from the home's first trial, the fortnight ran out
        // without a word.
        trialRemindersSent: "",
        currentPeriodEndsAt: null,
        // The group's add-ons left with the group. The live trial above is
        // what keeps aftercare running for the next fortnight, and after
        // that this location buys its own.
        entitlements: "",
        updatedAt: new Date(),
      })
      .where(eq(funeralHomesTable.id, home.id))
      .returning();

    const billingWarning = await matchGroupBills([home.groupId]);
    res.json({ ...toAdminHome(updated!), billingWarning });
    return;
  }

  // A subscription that has ended charges nobody; one still running, a
  // trial Stripe holds included, would be charged alongside the group's.
  if (hasLiveSubscription(home) && home.groupId === null) {
    throw new HttpError(
      409,
      "This home has its own subscription. Cancel it in Stripe first, or " +
        "the group's contract and this one will both be charged.",
    );
  }

  await recordPlatformAccess(
    who,
    "home.group.update",
    home,
    `Moved into "${target.name}"`,
  );

  const [updated] = await db
    .update(funeralHomesTable)
    .set({
      groupId: target.id,
      // Adopt the contract it is now covered by. The webhook keeps these in
      // step from here on — see `applyGroupSubscription`.
      subscriptionStatus: target.subscriptionStatus,
      trialEndsAt: target.trialEndsAt,
      currentPeriodEndsAt: target.currentPeriodEndsAt,
      entitlements: target.entitlements,
      updatedAt: new Date(),
    })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();

  // The group it left, if it came from one, and the group it joined.
  const billingWarning = await matchGroupBills([home.groupId, target.id]);
  res.json({ ...toAdminHome(updated!), billingWarning });
});

const GroupCheckoutBody = z.object({
  // A real web address: Stripe refuses anything else, and refuses it with an
  // error the console could only pass on as "something went wrong".
  returnUrl: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine(
      (value) => /^https?:\/\//.test(value),
      "Please give a web address starting with http:// or https://",
    ),
  email: z.string().trim().email().max(254),
  addOns: z.array(z.string().refine(isAddOnKey)).optional(),
});

/**
 * Start the group's subscription.
 *
 * The base line is quantity-per-location and the per-case line is metered
 * across the whole estate, which is the shape a rollup actually wants: one
 * invoice, one renewal date, and a volume number their finance team can
 * reconcile against their own case count.
 */
router.post("/admin/groups/:groupId/checkout", async (req, res) => {
  const who = actor(req);
  const group = await loadGroup(who, req.params.groupId);
  const body = parseBody(GroupCheckoutBody, req.body);

  if (!isBillingConfigured()) {
    throw badRequest(
      "Billing is not set up on this deployment. Nothing is being charged.",
    );
  }

  const [row] = await db
    .select({ total: count() })
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.groupId, group.id));

  const locations = row?.total ?? 0;

  if (locations === 0) {
    throw badRequest(
      "Put at least one location in this group before starting its contract.",
    );
  }

  await recordPlatformAccess(
    who,
    "group.checkout",
    null,
    `Started checkout for "${group.name}" (${locations} locations)`,
  );

  res.json({
    url: await createGroupCheckoutSession({
      group,
      email: body.email,
      returnUrl: body.returnUrl,
      addOns: body.addOns as AddOnKey[] | undefined,
      locations,
    }),
  });
});

export default router;

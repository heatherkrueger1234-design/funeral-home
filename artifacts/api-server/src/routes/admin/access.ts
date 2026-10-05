import { db, funeralHomesTable, platformAuditTable } from "@workspace/db";
import { and, desc, eq, lt } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { normaliseEmail } from "../../lib/auth";
import { badRequest, parseBody, parseId, parseQuery } from "../../lib/http";
import { logger } from "../../lib/logger";
import {
  grantPlatformAdmin,
  listPlatformAdmins,
  revokePlatformAdmin,
} from "../../lib/platform-auth";
import {
  actor,
  AUDIT_ACTIONS,
  platformLoadHome,
  recordPlatformAccess,
  toAdminHome,
} from "./shared";

/** The audit log, who may use this console, and our own accounts. */
const router: IRouter = Router();

/* ---------------------------------------------------------- the log -- */

const AuditQuery = z.object({
  homeId: z.coerce.number().int().positive().optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  /**
   * Older than this entry. An id rather than a page number, because the log
   * grows at the top while somebody is reading it: "page 2" would shift under
   * them and repeat lines, where "older than #4812" means the same thing
   * however many rows arrive in the meantime.
   */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * The log, readable by the people it is a record of.
 *
 * Not because that makes it tamper-proof — it does not — but because a log
 * nobody can see is a log nobody checks, and the first person who should
 * notice an odd pattern of access is the person who runs the platform.
 *
 * Reading the log is the one thing under `/admin` that does not itself write
 * a line. It reads no home's data — only the record of earlier reads — and a
 * log that grew every time somebody scrolled it would bury the entries that
 * matter under entries about looking.
 */
/* ---------------------------------------------- who may look at all this -- */

/**
 * The list itself, readable from the console.
 *
 * Deliberately readable by every platform admin rather than by some senior
 * subset: there is one capability here and no hierarchy, and a list of who can
 * see customers' data that only some of those people may read is a worse
 * arrangement than one everybody can check.
 *
 * Audited like any other cross-tenant read. It names no home, so the subject is
 * null — but "who looked at the access list" is exactly the sort of question the
 * log exists to answer.
 */
router.get("/admin/admins", async (req, res) => {
  const who = actor(req);
  const admins = await listPlatformAdmins();

  await recordPlatformAccess(
    who,
    "platform.admins.list",
    null,
    `${admins.filter((row) => row.revokedAt === null).length} active`,
  );

  res.json(
    admins.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      note: row.note,
      addedByEmail: row.addedByEmail,
      revokedAt: row.revokedAt,
      revokedByEmail: row.revokedByEmail,
      createdAt: row.createdAt,
    })),
  );
});

const GrantAdminBody = z.object({
  email: z.string().trim().email().max(320),
  displayName: z.string().trim().max(120).optional(),
  note: z.string().trim().max(400).optional(),
});

/**
 * Add somebody to the list.
 *
 * Note what this does *not* do: create an account, send an invitation, or grant
 * anything by itself. It records that if an account with this address signs in,
 * it may use this console. Someone named here with no staff account still
 * cannot get in, which is the property that lets access be arranged before a
 * new colleague's first day without opening anything early.
 */
router.post("/admin/admins", async (req, res) => {
  const who = actor(req);
  const values = parseBody(GrantAdminBody, req.body);

  const { admin: granted, previous } = await grantPlatformAdmin({
    email: values.email,
    displayName: values.displayName ?? null,
    note: values.note ?? null,
    addedByEmail: who.email,
  });

  // A restoration says so, and says what it undid. The row can only hold
  // who has access now; this line is where "they were taken off in March by
  // X and put back in June by Y" survives.
  const detail = previous?.revokedAt
    ? `restored ${granted.email}, removed ${previous.revokedAt.toISOString().slice(0, 10)}` +
      (previous.revokedByEmail ? ` by ${previous.revokedByEmail}` : "")
    : previous
      ? `granted ${granted.email} (already had access)`
      : `granted ${granted.email}`;

  await recordPlatformAccess(who, "platform.admin.grant", null, detail);

  logger.warn(
    { actor: who.email, granted: granted.email },
    "Platform admin access granted",
  );

  res.status(201).json({
    id: granted.id,
    email: granted.email,
    displayName: granted.displayName,
    note: granted.note,
    addedByEmail: granted.addedByEmail,
    revokedAt: granted.revokedAt,
    revokedByEmail: granted.revokedByEmail,
    createdAt: granted.createdAt,
  });
});

/**
 * Take somebody off it.
 *
 * You cannot revoke yourself. Not for safety — a platform admin who wants out
 * can be removed by a colleague — but because the alternative is a console with
 * nobody in it and no way back except a redeploy, which is the exact failure the
 * environment variable used to cause. The same reasoning guards a home owner
 * deactivating their own account in `routes/home.ts`.
 */
router.delete("/admin/admins/:email", async (req, res) => {
  const who = actor(req);
  // Express has already decoded the path segment. Decoding it a second time
  // threw a 500 on an address containing "%", and quietly changed one that
  // contained an encoded sequence.
  const email = normaliseEmail(req.params.email ?? "");

  if (!email) throw badRequest("Which address should be removed?");

  if (email === who.email) {
    throw badRequest(
      "You cannot remove your own access. Ask another platform admin to do it.",
    );
  }

  const revoked = await revokePlatformAdmin({
    email,
    revokedByEmail: who.email,
  });

  if (!revoked) {
    throw badRequest("That address is not on the list.");
  }

  await recordPlatformAccess(
    who,
    "platform.admin.revoke",
    null,
    `revoked ${email}`,
  );

  logger.warn(
    { actor: who.email, revoked: email },
    "Platform admin access revoked",
  );

  res.status(204).end();
});

/* ------------------------------------------------- ours, not a customer's -- */

const InternalBody = z.object({ internalAccount: z.boolean() });

/**
 * Mark a home as ours, or as a customer's.
 *
 * An internal home leaves the customer list, the counts and the engagement
 * figures, and changes in no other way — it opens cases, texts families and
 * prints orders of service exactly as any other tenant does, which is what
 * makes it useful for trying something before a real home sees it.
 *
 * This is a write that touches a tenant, so it joins suspension on the short
 * list of them. It cannot lose anybody any data: the only thing it changes is
 * whether the row appears in figures the vendor makes about itself.
 */
router.put("/admin/homes/:homeId/internal", async (req, res) => {
  const who = actor(req);
  const values = parseBody(InternalBody, req.body);
  const homeId = parseId(req.params.homeId);

  const home = await platformLoadHome(
    who,
    homeId,
    "home.internal.update",
    values.internalAccount ? "marked ours" : "marked a customer's",
  );

  const [updated] = await db
    .update(funeralHomesTable)
    .set({ internalAccount: values.internalAccount, updatedAt: new Date() })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();

  res.json(toAdminHome(updated!));
});

router.get("/admin/audit", async (req, res) => {
  const options = parseQuery(AuditQuery, req.query);

  // Ordered by id alone. It is assigned in insert order, so it is the same
  // order as `createdAt`, and it is the only ordering a `before` cursor can
  // page through without skipping two lines written in the same millisecond.
  const rows = await db
    .select()
    .from(platformAuditTable)
    .where(
      and(
        options.homeId
          ? eq(platformAuditTable.subjectHomeId, options.homeId)
          : undefined,
        options.action
          ? eq(platformAuditTable.action, options.action)
          : undefined,
        options.before ? lt(platformAuditTable.id, options.before) : undefined,
      ),
    )
    .orderBy(desc(platformAuditTable.id))
    .limit(options.limit);

  res.json(rows);
});

export default router;

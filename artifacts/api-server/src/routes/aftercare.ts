import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  aftercareEnrollmentsTable,
  funeralHomesTable,
  AFTERCARE_COPY_KEYS,
  AFTERCARE_TOUCHPOINTS,
  type AftercareCopyKey,
  type FuneralHome,
} from "@workspace/db";
import { UpdateAftercareSettingsBody } from "@workspace/api-zod";
import { AFTERCARE_DEFAULT_COPY } from "@workspace/mailer/aftercare";
import { currentUser, tenant } from "../middleware/require-auth";
import { aftercareForCase, offeredTouchpoints } from "../lib/aftercare";
import { assertHasUpdates, badRequest, parseBody, parseId, requireRow } from "../lib/http";
import { loadCase } from "./cases";

const router: IRouter = Router();

router.get("/cases/:caseId/aftercare", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  res.json(await aftercareForCase(row.id, home.id));
});

/**
 * Stop one person's check-ins, because they telephoned and asked.
 *
 * The unsubscribe page has always told a family "the funeral home can stop
 * them for you if you telephone", and until 5 October the console had no
 * way to. Final, like the family's own "no": `unsubscribedAt` is set once
 * and nothing clears it, so a mistaken click cannot be undone here either —
 * the console asks first.
 */
router.post("/cases/:caseId/aftercare/:enrollmentId/stop", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const id = parseId(req.params.enrollmentId);

  const [enrollment] = await db
    .select({ id: aftercareEnrollmentsTable.id })
    .from(aftercareEnrollmentsTable)
    .where(
      and(
        eq(aftercareEnrollmentsTable.id, id),
        eq(aftercareEnrollmentsTable.caseId, row.id),
        eq(aftercareEnrollmentsTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);
  requireRow(enrollment, "Those check-ins could not be found.");

  const now = new Date();
  await db
    .update(aftercareEnrollmentsTable)
    .set({ status: "done", unsubscribedAt: now, updatedAt: now })
    .where(
      and(
        eq(aftercareEnrollmentsTable.id, id),
        isNull(aftercareEnrollmentsTable.unsubscribedAt),
      ),
    );

  res.json(await aftercareForCase(row.id, home.id));
});

const LABELS: Record<AftercareCopyKey, string> = {
  "30": "A month on",
  "60": "Two months on",
  "90": "Three months on",
  "365": "A year after the service",
  birthday: "Their birthday",
  holidays: "The first holidays",
  death_anniversary: "A year since the death",
};

/** What the home sends, as Settings shows it: its own words or ours. */
function aftercareSettings(home: FuneralHome) {
  const copy = home.aftercareCopy ?? {};
  return {
    touchpoints: offeredTouchpoints(home),
    messages: AFTERCARE_COPY_KEYS.map((key) => {
      const own = copy[key];
      const fallback = AFTERCARE_DEFAULT_COPY[key];
      return {
        key,
        label: LABELS[key],
        subject: own?.subject ?? fallback.subject,
        body: own?.body ?? fallback.body,
        defaultSubject: fallback.subject,
        defaultBody: fallback.body,
        custom: Boolean(own),
      };
    }),
  };
}

router.get("/home/aftercare", (req, res) => {
  res.json(aftercareSettings(tenant(req)));
});

/**
 * Change the notes. A message sent with a null subject and body goes back
 * to our wording. `{name}` stands for the person who died.
 */
router.put("/home/aftercare", async (req, res) => {
  const home = tenant(req);
  if (currentUser(req).role !== "owner") {
    throw badRequest("Only an owner can change what the home sends.");
  }
  const values = assertHasUpdates(parseBody(UpdateAftercareSettingsBody, req.body));

  const copy: Record<string, { subject: string; body: string }> = { ...(home.aftercareCopy ?? {}) };
  for (const message of values.messages ?? []) {
    const subject = message.subject?.trim() ?? "";
    const body = message.body?.trim() ?? "";
    if (!subject && !body) {
      delete copy[message.key];
      continue;
    }
    if (!subject || !body) throw badRequest("A note needs both a subject and a message.");
    copy[message.key] = { subject, body };
  }

  const touchpoints = values.touchpoints
    ? AFTERCARE_TOUCHPOINTS.filter((kind) => values.touchpoints!.includes(kind)).join(",")
    : home.aftercareTouchpoints;

  const [updated] = await db
    .update(funeralHomesTable)
    .set({
      aftercareCopy: Object.keys(copy).length > 0 ? copy : null,
      aftercareTouchpoints: touchpoints,
      updatedAt: new Date(),
    })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();

  res.json(aftercareSettings(updated!));
});

export default router;

import { Router, type IRouter } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  aftercareDeliveriesTable,
  aftercareEnrollmentsTable,
  appointmentSlotsTable,
  casePhotosTable,
  casePrintItemsTable,
  caseStatutoryClocksTable,
  caseStatutoryDeadlinesTable,
  casesTable,
  familyContactsTable,
  obituaryDraftsTable,
  decedentDisplayName,
  describeStanding,
  isStopKeyword,
  standingOf,
  type AppointmentSlot,
  type Case,
  type CaseStatutoryClock,
  type CaseStatutoryDeadline,
  type MessagingChannel,
  type MessagingConsent,
} from "@workspace/db";
import {
  ConfirmStatutoryClockBody,
  OfferSlotsBody,
  RecordMessagingConsentBody,
  SetFamilyMessagingConsentBody,
  TextFamilyAboutSlotsBody,
  UpdateStatutoryDeadlineBody,
} from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  HttpError,
  parseBody,
  parseId,
  requireRow,
} from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import {
  familyCase,
  familyContact,
  familyHome,
} from "../middleware/require-family";
import { engagementForCase, engagementForHomes } from "../lib/engagement";
import { applyStatutoryDeadlines, statutoryClockFor } from "../lib/timeline";
import {
  consentFor,
  honourStop,
  recordConsent,
  sendConsentedSms,
  storableAddress,
} from "../lib/consent";
import { findTemplate } from "../lib/print-templates";
import { SmsNotSentError } from "../lib/sms";
import { logger } from "../lib/logger";
import { loadCase } from "./cases";

/**
 * Engagement, dates, and what a family is left with.
 *
 * Four things that look unrelated and are not. They are the whole of this
 * product's relationship with a family once the director closes the laptop:
 * a handful of messages, a handful of dates, the clock the state runs on a
 * death, and the page they still open in March.
 *
 * Three rules hold across all of it and none is negotiable:
 *
 *  1. **Counting happens once.** `lib/engagement.ts` computes it, and both
 *     consoles render it. A second implementation is two numbers that
 *     disagree and nobody able to say which is wrong.
 *  2. **Nothing sends without a consent row read at send time.** There is
 *     one function that texts — `sendConsentedSms` — and it refuses rather
 *     than asks forgiveness. The TCPA bills by the message.
 *  3. **Nothing here is urgent at a family.** No countdown, no red, no
 *     score. Where something is late, the words say so, once, calmly.
 */

const router: IRouter = Router();

/* ------------------------------------------------------------- counting -- */

/**
 * The home's own totals, and the handful of cases worth a telephone call.
 *
 * Deliberately not every case. A director reading this at eight in the
 * morning wants the three families something can be done about, and a list
 * that includes everybody is a list nobody opens twice.
 */
router.get("/engagement", async (req, res) => {
  const home = tenant(req);

  const totals = await engagementForHomes([home.id]);

  const open = await db
    .select()
    .from(casesTable)
    .where(
      and(
        eq(casesTable.funeralHomeId, home.id),
        // Somebody arranging their own funeral in advance is not stuck, and
        // is not to be chased about photographs of themselves.
        eq(casesTable.kind, "at_need"),
        or(eq(casesTable.status, "intake"), eq(casesTable.status, "active")),
      ),
    )
    .orderBy(asc(casesTable.serviceAt), asc(casesTable.id));

  const cases = [];

  for (const row of open) {
    const engagement = await engagementForCase(row);
    if (engagement.attention.length === 0) continue;

    cases.push({
      caseId: row.id,
      displayName: decedentDisplayName(row),
      status: row.status,
      serviceAt: row.serviceAt,
      attention: engagement.attention,
    });
  }

  res.json({ home: totals.get(home.id)!, cases });
});

router.get("/cases/:caseId/engagement", async (req, res) => {
  const row = await loadCase(req, req.params.caseId);
  res.json(await engagementForCase(row));
});

/* --------------------------------------------------- Colorado's own clock */

function toStatutoryDeadlineJson(row: CaseStatutoryDeadline, now = new Date()) {
  const standing = standingOf(row, now);

  return {
    id: row.id,
    caseId: row.caseId,
    key: row.key,
    title: row.title,
    description: row.description,
    citation: row.citation,
    anchor: row.anchor,
    dueAt: row.dueAt,
    completedAt: row.completedAt,
    notApplicableAt: row.notApplicableAt,
    notApplicableReason: row.notApplicableReason,
    standing,
    standingLabel: describeStanding(standing),
  };
}

function toClockJson(clock: CaseStatutoryClock) {
  return {
    custodyTakenAt: clock.custodyTakenAt,
    custodyAssumed: clock.custodyAssumed,
    edrsRequestedAt: clock.edrsRequestedAt,
    confirmedAt: clock.confirmedAt,
  };
}

/**
 * Built on read, never behind a button.
 *
 * These are not a preference a home opted into; they are the law in the
 * state it operates in. A home that has to press something to be told about
 * its own 72 hours gets told about them by the registrar instead.
 */
async function statutoryScheduleFor(row: Case) {
  /*
   * Somebody arranging their own funeral in advance is alive, and none of
   * this applies to them. Returning early rather than building an empty
   * schedule also keeps us from writing a row that says when we took custody
   * of a person sitting at home perfectly well.
   */
  if (row.kind === "pre_need") {
    return {
      clock: {
        custodyTakenAt: null,
        custodyAssumed: false,
        edrsRequestedAt: null,
        confirmedAt: null,
      },
      deadlines: [],
    };
  }

  await applyStatutoryDeadlines(row);

  const clock = await statutoryClockFor(row);

  const deadlines = await db
    .select()
    .from(caseStatutoryDeadlinesTable)
    .where(eq(caseStatutoryDeadlinesTable.caseId, row.id))
    .orderBy(
      asc(caseStatutoryDeadlinesTable.dueAt),
      asc(caseStatutoryDeadlinesTable.id),
    );

  return {
    clock: toClockJson(clock),
    deadlines: deadlines.map((entry) => toStatutoryDeadlineJson(entry)),
  };
}

router.get("/cases/:caseId/statutory", async (req, res) => {
  const row = await loadCase(req, req.params.caseId);
  res.json(await statutoryScheduleFor(row));
});

/**
 * Confirm the two dates only a director knows.
 *
 * This is the entire interaction Colorado asks of this product. Everything
 * downstream falls out of the statute, so there is nothing else for anybody
 * to construct and nothing else for anybody to get wrong. Saving marks the
 * custody date as no longer assumed, even when the director kept the date we
 * proposed — a confirmed date and a lucky guess are not the same record.
 */
router.put("/cases/:caseId/statutory/clock", async (req, res) => {
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const values = assertHasUpdates(
    parseBody(ConfirmStatutoryClockBody, req.body),
  );

  if (row.kind === "pre_need") {
    throw badRequest(
      "This file is for someone who is still living, so there is no custody date to record.",
    );
  }

  const clock = await statutoryClockFor(row);
  const now = new Date();

  await db
    .update(caseStatutoryClocksTable)
    .set({
      ...("custodyTakenAt" in values
        ? {
            custodyTakenAt: values.custodyTakenAt ?? null,
            custodyAssumed: false,
          }
        : {}),
      ...("edrsRequestedAt" in values
        ? { edrsRequestedAt: values.edrsRequestedAt ?? null }
        : {}),
      confirmedByUserId: user.id,
      confirmedAt: now,
      updatedAt: now,
    })
    .where(eq(caseStatutoryClocksTable.id, clock.id));

  res.json(await statutoryScheduleFor(row));
});

router.put("/statutory-deadlines/:statutoryDeadlineId", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const id = parseId(req.params.statutoryDeadlineId);
  const values = assertHasUpdates(
    parseBody(UpdateStatutoryDeadlineBody, req.body),
  );

  const [existing] = await db
    .select()
    .from(caseStatutoryDeadlinesTable)
    .where(
      and(
        eq(caseStatutoryDeadlinesTable.id, id),
        eq(caseStatutoryDeadlinesTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  const found = requireRow(existing, "That could not be found.");
  const now = new Date();

  const [updated] = await db
    .update(caseStatutoryDeadlinesTable)
    .set({
      ...(values.completed === undefined
        ? {}
        : values.completed
          ? { completedAt: now, completedByUserId: user.id }
          : { completedAt: null, completedByUserId: null }),
      ...(values.notApplicable === undefined
        ? {}
        : values.notApplicable
          ? {
              notApplicableAt: now,
              notApplicableReason: values.notApplicableReason ?? null,
            }
          : { notApplicableAt: null, notApplicableReason: null }),
      updatedAt: now,
    })
    .where(eq(caseStatutoryDeadlinesTable.id, found.id))
    .returning();

  res.json(toStatutoryDeadlineJson(updated!, now));
});

/* --------------------------------------------------------- offered times -- */

function toSlotJson(
  slot: AppointmentSlot,
  forCaseId: number | null,
  takenByName: string | null = null,
) {
  return {
    id: slot.id,
    kind: slot.kind,
    label: slot.label,
    startsAt: slot.startsAt,
    durationMinutes: slot.durationMinutes,
    location: slot.location,
    takenByContactId: slot.takenByContactId,
    takenByName,
    takenAt: slot.takenAt,
    withdrawnAt: slot.withdrawnAt,
    isMine: forCaseId !== null && slot.takenByCaseId === forCaseId,
  };
}

/** Every slot this case can see: offered to it, or taken by it. */
async function slotsVisibleTo(row: Case): Promise<AppointmentSlot[]> {
  return db
    .select()
    .from(appointmentSlotsTable)
    .where(
      and(
        eq(appointmentSlotsTable.funeralHomeId, row.funeralHomeId),
        or(
          eq(appointmentSlotsTable.caseId, row.id),
          eq(appointmentSlotsTable.takenByCaseId, row.id),
          /*
           * A slot with no case on it is the useful default — a director
           * opening three windows on Thursday morning does not want to
           * decide in advance which family gets them — so it is on offer to
           * everyone until somebody takes it.
           */
          and(
            isNull(appointmentSlotsTable.caseId),
            isNull(appointmentSlotsTable.takenByCaseId),
          ),
        ),
      ),
    )
    .orderBy(
      asc(appointmentSlotsTable.startsAt),
      asc(appointmentSlotsTable.id),
    );
}

/** Names for the slots somebody has taken, so a director sees who. */
async function nameForSlots(
  slots: AppointmentSlot[],
): Promise<Map<number, string>> {
  const contactIds = [
    ...new Set(
      slots
        .map((slot) => slot.takenByContactId)
        .filter((id): id is number => id !== null),
    ),
  ];

  if (contactIds.length === 0) return new Map();

  const rows = await db
    .select({ id: familyContactsTable.id, name: familyContactsTable.name })
    .from(familyContactsTable)
    .where(inArray(familyContactsTable.id, contactIds));

  return new Map(rows.map((row) => [row.id, row.name]));
}

router.get("/cases/:caseId/slots", async (req, res) => {
  const row = await loadCase(req, req.params.caseId);
  const slots = await slotsVisibleTo(row);
  const names = await nameForSlots(slots);

  res.json(
    slots.map((slot) =>
      toSlotJson(
        slot,
        row.id,
        slot.takenByContactId === null
          ? null
          : (names.get(slot.takenByContactId) ?? null),
      ),
    ),
  );
});

router.post("/cases/:caseId/slots", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const { slots } = parseBody(OfferSlotsBody, req.body);

  const created = await db
    .insert(appointmentSlotsTable)
    .values(
      slots.map((slot) => ({
        funeralHomeId: home.id,
        caseId: row.id,
        kind: slot.kind ?? "other",
        label: slot.label.trim(),
        startsAt: slot.startsAt,
        durationMinutes: slot.durationMinutes ?? 30,
        location: slot.location ?? null,
        offeredByUserId: user.id,
      })),
    )
    .returning();

  res.status(201).json(created.map((slot) => toSlotJson(slot, row.id)));
});

/**
 * Take a time back off the table.
 *
 * Withdrawn, never deleted, and that is the whole point of the column. A
 * family holding Thursday at four has to be told it is gone; watching it
 * vanish between two page loads is how somebody turns up anyway.
 */
router.delete("/slots/:slotId", async (req, res) => {
  const home = tenant(req);
  const id = parseId(req.params.slotId);

  const [existing] = await db
    .select()
    .from(appointmentSlotsTable)
    .where(
      and(
        eq(appointmentSlotsTable.id, id),
        eq(appointmentSlotsTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  const found = requireRow(existing, "That time could not be found.");

  const [updated] = await db
    .update(appointmentSlotsTable)
    .set({
      withdrawnAt: found.withdrawnAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(appointmentSlotsTable.id, found.id))
    .returning();

  res.json(toSlotJson(updated!, found.caseId));
});

/* ------------------------------------------------ the one thing that sends */

/**
 * Text the family that there are times to choose from.
 *
 * The only new sending path this component adds, and it goes through
 * `sendConsentedSms` like everything else must. A contact with no recorded
 * consent is reported back by name with the reason, rather than skipped
 * silently or sent to anyway — the director's next move is a telephone call,
 * and they can only make it if the screen tells them who to ring.
 */
router.post("/cases/:caseId/slots/notice", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const { contactIds } = parseBody(TextFamilyAboutSlotsBody, req.body);

  const open = (await slotsVisibleTo(row)).filter(
    (slot) =>
      slot.takenByCaseId === null &&
      slot.withdrawnAt === null &&
      slot.startsAt > new Date(),
  );

  if (open.length === 0) {
    throw badRequest("There are no times open to offer this family yet.");
  }

  const contacts = await db
    .select()
    .from(familyContactsTable)
    .where(
      and(
        eq(familyContactsTable.caseId, row.id),
        eq(familyContactsTable.funeralHomeId, home.id),
        inArray(familyContactsTable.id, contactIds),
      ),
    );

  const sent: { contactId: number; name: string }[] = [];
  const notSent: { contactId: number; name: string; reason: string }[] = [];

  for (const contact of contacts) {
    if (!contact.phone?.trim()) {
      notSent.push({
        contactId: contact.id,
        name: contact.name,
        reason: "There is no mobile number for this person.",
      });
      continue;
    }

    try {
      await sendConsentedSms({
        home,
        to: contact.phone,
        caseId: row.id,
        contactId: contact.id,
        body: `there ${open.length === 1 ? "is a time" : `are ${open.length} times`} to choose from on your page for ${decedentDisplayName(row)}.`,
      });
      sent.push({ contactId: contact.id, name: contact.name });
    } catch (error) {
      /*
       * Two different failures, both of which the director can act on and
       * neither of which should fail the whole request: no recorded consent
       * (ring them and record it), and a number the carrier refused (it is a
       * landline, or the deployment has no Twilio account). One bad number
       * in the middle of a list must not cancel the four after it.
       */
      if (error instanceof HttpError || error instanceof SmsNotSentError) {
        notSent.push({
          contactId: contact.id,
          name: contact.name,
          reason: error.message,
        });
        continue;
      }
      throw error;
    }
  }

  res.json({ sent, notSent });
});

/* ------------------------------------------ who said we may write to them */

function toConsentJson(
  row: MessagingConsent,
  name: string | null = null,
): Record<string, unknown> {
  return {
    contactId: row.contactId,
    name,
    channel: row.channel,
    address: row.address,
    granted: row.revokedAt === null,
    grantedAt: row.grantedAt,
    source: row.source,
    sourceDetail: row.sourceDetail,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
  };
}

router.get("/cases/:caseId/messaging-consent", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  const contacts = await db
    .select()
    .from(familyContactsTable)
    .where(eq(familyContactsTable.caseId, row.id));

  const states = [];

  /*
   * Walked per contact rather than queried by case, because the consent row
   * belongs to the *address*, not to the case. The same daughter's number
   * carries a stop she sent during her father's funeral in March into her
   * mother's in November, and a director looking at the November case has to
   * be able to see that.
   */
  for (const contact of contacts) {
    for (const channel of ["sms", "email"] as const) {
      const address = channel === "sms" ? contact.phone : contact.email;
      if (!address?.trim()) continue;

      const stored = storableAddress(channel, address);
      if (!stored) continue;

      const held = await consentFor(home.id, channel, stored);

      states.push(
        held
          ? toConsentJson(held, contact.name)
          : {
              contactId: contact.id,
              name: contact.name,
              channel,
              address: stored,
              granted: false,
              grantedAt: null,
              source: null,
              sourceDetail: null,
              revokedAt: null,
              revokedReason: null,
            },
      );
    }
  }

  res.json(states);
});

/**
 * Record the yes that happened on the telephone.
 *
 * A director cannot record a no here, and that is deliberate: a refusal
 * belongs to the person who gave it, comes in through the family portal or
 * as a STOP, and is permanent. Letting a console toggle it would make the
 * one irreversible thing in this file reversible from a dropdown.
 */
router.post("/cases/:caseId/messaging-consent", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const values = parseBody(RecordMessagingConsentBody, req.body);
  const channel: MessagingChannel = values.channel ?? "sms";

  const [contact] = await db
    .select()
    .from(familyContactsTable)
    .where(
      and(
        eq(familyContactsTable.id, values.contactId),
        eq(familyContactsTable.caseId, row.id),
      ),
    )
    .limit(1);

  const found = requireRow(contact, "That contact is not on this case.");
  const address = channel === "sms" ? found.phone : found.email;

  if (!address?.trim()) {
    throw badRequest(
      channel === "sms"
        ? "There is no mobile number for this person."
        : "There is no email address for this person.",
    );
  }

  const stored = await recordConsent({
    funeralHomeId: home.id,
    channel,
    address,
    source: "director_recorded",
    sourceDetail: values.sourceDetail ?? null,
    caseId: row.id,
    contactId: found.id,
    recordedByUserId: user.id,
  });

  res.status(201).json(toConsentJson(stored, found.name));
});

/* --------------------------------------------- what the family is left with */

/**
 * What is left once everyone has gone home.
 *
 * The photographs, the obituary as it was published, the order of service,
 * and the check-ins still to come. Built here, inside this product, and it
 * must not quietly become a handoff to another one — see `Remember-Me` for
 * why that separation is load-bearing and why nothing sensitive lives here.
 *
 * `phase` is the whole feature in one word. Until the service it is
 * `arranging` and the portal shows the working surfaces; afterwards it is
 * `keeping` and they recede. Nothing is deleted and nothing is locked — the
 * family can still open every screen. They simply stop being the first thing
 * on the page, because by then what the family wants is the photographs.
 */
async function keepsakeFor(row: Case, contactId: number | null) {
  const now = new Date();
  const keeping =
    row.status === "closed" || (row.serviceAt !== null && row.serviceAt < now);

  const [photos, obituary, documents] = await Promise.all([
    db
      .select()
      .from(casePhotosTable)
      .where(
        and(
          eq(casePhotosTable.caseId, row.id),
          eq(casePhotosTable.status, "visible"),
        ),
      )
      .orderBy(asc(casePhotosTable.position), asc(casePhotosTable.id)),
    db
      .select()
      .from(obituaryDraftsTable)
      .where(eq(obituaryDraftsTable.caseId, row.id))
      .limit(1),
    db
      .select()
      .from(casePrintItemsTable)
      .where(
        and(
          eq(casePrintItemsTable.caseId, row.id),
          eq(casePrintItemsTable.sharedWithFamily, true),
        ),
      )
      .orderBy(asc(casePrintItemsTable.id)),
  ]);

  const enrollment = contactId
    ? (
        await db
          .select()
          .from(aftercareEnrollmentsTable)
          .where(eq(aftercareEnrollmentsTable.contactId, contactId))
          .limit(1)
      )[0]
    : (
        await db
          .select()
          .from(aftercareEnrollmentsTable)
          .where(eq(aftercareEnrollmentsTable.caseId, row.id))
          .limit(1)
      )[0];

  const checkIns = enrollment
    ? await db
        .select()
        .from(aftercareDeliveriesTable)
        .where(eq(aftercareDeliveriesTable.enrollmentId, enrollment.id))
        .orderBy(asc(aftercareDeliveriesTable.dayOffset))
    : [];

  const draft = obituary[0];

  return {
    phase: keeping ? "keeping" : "arranging",
    displayName: decedentDisplayName(row),
    serviceAt: row.serviceAt,
    serviceLocation: row.serviceLocation,
    /*
     * Only the approved text. A half-written draft is not what anybody wants
     * to be handed back in March, and showing one would also be showing the
     * family words the home has not signed off on.
     */
    obituary:
      draft && draft.status === "approved" ? (draft.draftText ?? null) : null,
    photos: photos.map((photo) => ({
      id: photo.id,
      uploadId: photo.uploadId,
      caption: photo.caption,
      selected: photo.selected,
    })),
    documents: documents.map((item) => ({
      id: item.id,
      title:
        item.title ?? findTemplate(item.templateKey)?.name ?? "Printed piece",
      kind: item.templateKey,
    })),
    checkIns: checkIns.map((entry) => ({
      id: entry.id,
      dayOffset: entry.dayOffset,
      dueAt: entry.dueAt,
      sentAt: entry.sentAt,
    })),
    checkInsStatus: enrollment?.status ?? null,
  };
}

router.get("/cases/:caseId/keepsake", async (req, res) => {
  const row = await loadCase(req, req.params.caseId);
  res.json(await keepsakeFor(row, null));
});

export default router;

/* ========================================================================= */
/*  The family's side of all of this.                                        */
/* ========================================================================= */

/**
 * Mounted under `/family` alongside `familyRouter`, sharing its gate and its
 * limiter rather than taking a mount of its own — see the comment block in
 * `routes/index.ts` for why a second mount would halve a family's request
 * budget and record their visit twice for one page load.
 *
 * No path here carries a case id. The token names exactly one case, which is
 * what makes the whole surface safe to hand to a stranger holding a
 * forwarded text message.
 */
export const familyEngagementRouter: IRouter = Router();

familyEngagementRouter.get("/slots", async (req, res) => {
  const row = familyCase(req);
  const contact = familyContact(req);

  const slots = (await slotsVisibleTo(row)).filter(
    (slot) =>
      // The family is shown what it can still act on, plus what it holds.
      slot.takenByCaseId === row.id ||
      (slot.withdrawnAt === null && slot.startsAt > new Date()),
  );

  res.json(
    slots.map((slot) =>
      toSlotJson(
        slot,
        row.id,
        slot.takenByContactId === contact.id ? contact.name : null,
      ),
    ),
  );
});

/**
 * Take one of the offered times.
 *
 * The claim is a conditional update rather than a read followed by a write,
 * and the `is null` in the predicate is the whole of the concurrency story:
 * two daughters tapping the same eleven o'clock at the same moment produce
 * one booking and one "somebody took that one first", instead of two
 * families in the same room.
 */
familyEngagementRouter.post("/slots/:slotId/take", async (req, res) => {
  const row = familyCase(req);
  const contact = familyContact(req);
  const id = parseId(req.params.slotId);

  const [existing] = await db
    .select()
    .from(appointmentSlotsTable)
    .where(
      and(
        eq(appointmentSlotsTable.id, id),
        eq(appointmentSlotsTable.funeralHomeId, row.funeralHomeId),
      ),
    )
    .limit(1);

  const found = requireRow(existing, "That time is no longer on offer.");

  if (found.withdrawnAt !== null) {
    throw new HttpError(409, "The funeral home has taken that time back.");
  }

  if (found.caseId !== null && found.caseId !== row.id) {
    throw new HttpError(409, "That time is not one of yours to take.");
  }

  if (found.startsAt <= new Date()) {
    throw new HttpError(409, "That time has already passed.");
  }

  const [claimed] = await db
    .update(appointmentSlotsTable)
    .set({
      takenByCaseId: row.id,
      takenByContactId: contact.id,
      takenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appointmentSlotsTable.id, found.id),
        isNull(appointmentSlotsTable.takenByCaseId),
        isNull(appointmentSlotsTable.withdrawnAt),
      ),
    )
    .returning();

  if (!claimed) {
    throw new HttpError(
      409,
      "Somebody took that one a moment ago. The others are still open.",
    );
  }

  res.json(toSlotJson(claimed, row.id, contact.name));
});

/** Give a time back. It goes on offer again rather than disappearing. */
familyEngagementRouter.post("/slots/:slotId/release", async (req, res) => {
  const row = familyCase(req);
  const id = parseId(req.params.slotId);

  const [released] = await db
    .update(appointmentSlotsTable)
    .set({
      takenByCaseId: null,
      takenByContactId: null,
      takenAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appointmentSlotsTable.id, id),
        eq(appointmentSlotsTable.takenByCaseId, row.id),
      ),
    )
    .returning();

  // Not found, already released, or never this family's. All three are the
  // same sentence to the person reading it, and the same non-event.
  requireRow(released, "That time is not one you are holding.");

  res.json(toSlotJson(released, row.id));
});

/**
 * Say whether the home may text this number.
 *
 * "Yes" is a consent row with a timestamp and a source. "No" is a stop, and
 * it is honoured the same way a stop texted to a carrier is: permanently,
 * across every message type including the aftercare check-ins, and with no
 * screen anywhere that asks again.
 */
familyEngagementRouter.post("/messaging-consent", async (req, res) => {
  const row = familyCase(req);
  const home = familyHome(req);
  const contact = familyContact(req);
  const values = parseBody(SetFamilyMessagingConsentBody, req.body);
  const channel: MessagingChannel = values.channel ?? "sms";

  const address = channel === "sms" ? contact.phone : contact.email;

  if (!address?.trim()) {
    throw badRequest(
      channel === "sms"
        ? "There is no mobile number on file for you."
        : "There is no email address on file for you.",
    );
  }

  if (!values.consent) {
    await honourStop(channel, address, "Asked us to stop, on their own page");

    const stored = storableAddress(channel, address)!;
    const held = await consentFor(home.id, channel, stored);

    res.json(
      held
        ? toConsentJson(held, contact.name)
        : {
            contactId: contact.id,
            name: contact.name,
            channel,
            address: stored,
            granted: false,
            grantedAt: null,
            source: null,
            sourceDetail: null,
            revokedAt: new Date(),
            revokedReason: "Asked us to stop, on their own page",
          },
    );
    return;
  }

  const stored = await recordConsent({
    funeralHomeId: home.id,
    channel,
    address,
    source: "family_portal",
    sourceDetail: `Agreed on ${decedentDisplayName(row)}'s page`,
    caseId: row.id,
    contactId: contact.id,
  });

  res.json(toConsentJson(stored, contact.name));
});

familyEngagementRouter.get("/keepsake", async (req, res) => {
  const row = familyCase(req);
  const contact = familyContact(req);
  res.json(await keepsakeFor(row, contact.id));
});

/* ========================================================================= */
/*  STOP, arriving from a carrier.                                           */
/* ========================================================================= */

/**
 * Twilio's inbound webhook, and the only unauthenticated write in this file.
 *
 * Mounted above every gate for the same reason the Stripe webhook is: a
 * carrier has no session and never will. It is guarded instead by Twilio's
 * own request signature, and refuses outright on a deployment with no auth
 * token configured rather than accepting an unsigned request — an endpoint
 * that can unsubscribe anybody who knows a phone number is not one to leave
 * open.
 *
 * Deliberately absent from `openapi.yaml`, like the Stripe webhook and the
 * scheduled tasks: the contract here is Twilio's, the body is form-encoded
 * and the response is XML, none of which our generated client should learn.
 */
export const engagementWebhookRouter: IRouter = Router();

function twilioSignatureIsValid(
  url: string,
  params: Record<string, unknown>,
  signature: string | undefined,
  authToken: string,
): boolean {
  if (!signature) return false;

  /*
   * Twilio signs the full URL with every POST parameter appended in key
   * order, HMAC-SHA1 under the account's auth token. Reimplemented here
   * rather than pulled in with the SDK, which is the same trade `sms.ts`
   * makes for the sending half: one documented algorithm against a large
   * dependency on the path a family's phone number travels.
   */
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + String(params[key]), url);

  const expected = createHmac("sha1", authToken)
    .update(payload)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);

  return a.length === b.length && timingSafeEqual(a, b);
}

engagementWebhookRouter.post("/sms/inbound", async (req, res) => {
  const authToken = process.env["TWILIO_AUTH_TOKEN"];

  if (!authToken) {
    throw new HttpError(
      503,
      "Text messaging is not set up on this deployment.",
    );
  }

  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const params = (req.body ?? {}) as Record<string, unknown>;

  if (
    !twilioSignatureIsValid(
      url,
      params,
      req.headers["x-twilio-signature"] as string | undefined,
      authToken,
    )
  ) {
    throw new HttpError(403, "Not authorised.");
  }

  const from = String(params["From"] ?? "");
  const body = String(params["Body"] ?? "");

  if (from && isStopKeyword(body)) {
    const result = await honourStop("sms", from, body.trim().toUpperCase());
    logger.info({ ...result }, "Stop request from a carrier");
  }

  /*
   * Twilio expects TwiML, and an empty response is how you say "received,
   * send nothing back". Replying to a STOP would be sending one more message
   * to somebody who has just asked for none — the carrier sends its own
   * confirmation, and it is the only one anybody needs.
   */
  res.type("text/xml").send("<Response></Response>");
});

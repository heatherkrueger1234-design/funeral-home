import {
  aftercareDeliveriesTable,
  aftercareEnrollmentsTable,
  caseDeadlinesTable,
  caseMessagesTable,
  casePhotosTable,
  casePrintItemsTable,
  db,
  decedentDisplayName,
  MAX_PHOTOS_PER_CASE,
  obituaryDraftsTable,
  toPublicFamilyContact,
  toStaffSignature,
  usersTable,
} from "@workspace/db";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  offeredTouchpoints,
  toDeliveryJson,
  touchpointDates,
} from "../../lib/aftercare";
import {
  chosenOffer,
  isAwaitingChoice,
  openOfferCount,
} from "../../lib/service-offers";
import { isSmsConfigured } from "../../lib/sms";
import { publicHome } from "../../lib/storefront";
import { isThreadLocked } from "../../lib/thread";
import {
  familyCase,
  familyContact,
  familyHome,
} from "../../middleware/require-family";

/** The portal's one read: everything it needs to draw itself. Mounted under /family; see `index.ts`. */
const router: IRouter = Router();

/* ----------------------------------------------------------- the session -- */

/**
 * Everything the portal needs to draw itself, in one call.
 *
 * This is opened on a phone, on mobile data, at a kitchen table, by someone
 * who has not slept. Four round trips before anything renders is four
 * chances to look broken, so the counts are gathered here rather than by the
 * screens that show them.
 */
router.get("/session", async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);
  const home = familyHome(req);

  const [
    photos,
    selectedPhotos,
    deadlines,
    unread,
    obituary,
    lead,
    aftercare,
    home_,
    openOffers,
    settled,
    proofs,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(casePhotosTable)
      .where(eq(casePhotosTable.caseId, row.id)),
    db
      .select({ value: count() })
      .from(casePhotosTable)
      .where(
        and(
          eq(casePhotosTable.caseId, row.id),
          eq(casePhotosTable.selected, true),
        ),
      ),
    db
      .select({ value: count() })
      .from(caseDeadlinesTable)
      .where(
        and(
          eq(caseDeadlinesTable.caseId, row.id),
          isNull(caseDeadlinesTable.completedAt),
          eq(caseDeadlinesTable.isEvent, false),
        ),
      ),
    db
      .select({ value: count() })
      .from(caseMessagesTable)
      .where(
        and(
          eq(caseMessagesTable.caseId, row.id),
          isNull(caseMessagesTable.authorContactId),
          isNull(caseMessagesTable.readAt),
        ),
      ),
    db
      .select({ status: obituaryDraftsTable.status })
      .from(obituaryDraftsTable)
      .where(eq(obituaryDraftsTable.caseId, row.id))
      .limit(1),
    row.leadDirectorId === null
      ? Promise.resolve([])
      : db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, row.leadDirectorId))
          .limit(1),
    db
      .select()
      .from(aftercareEnrollmentsTable)
      .where(eq(aftercareEnrollmentsTable.contactId, contact.id))
      .limit(1),
    publicHome(home),
    openOfferCount(row.id),
    chosenOffer(row.id),
    db
      .select({ value: count() })
      .from(casePrintItemsTable)
      .where(
        and(
          eq(casePrintItemsTable.caseId, row.id),
          eq(casePrintItemsTable.sharedWithFamily, true),
          eq(casePrintItemsTable.status, "proof"),
        ),
      ),
  ]);

  const deliveries = aftercare[0]
    ? await db
        .select()
        .from(aftercareDeliveriesTable)
        .where(eq(aftercareDeliveriesTable.enrollmentId, aftercare[0].id))
        .orderBy(asc(aftercareDeliveriesTable.dueAt))
    : [];

  res.json({
    contact: toPublicFamilyContact(contact),
    home: home_,
    case: { ...row, displayName: decedentDisplayName(row) },
    leadDirector: lead[0] ? toStaffSignature(lead[0]) : null,
    photoCount: Number(photos[0]?.value ?? 0),
    photoLimit: MAX_PHOTOS_PER_CASE,
    selectedPhotoCount: Number(selectedPhotos[0]?.value ?? 0),
    slideshowTarget: home.slideshowTarget,
    obituaryStatus: obituary[0]?.status ?? "family_draft",
    outstandingDeadlines: Number(deadlines[0]?.value ?? 0),
    unreadMessages: Number(unread[0]?.value ?? 0),
    messagesLocked: isThreadLocked(row),
    proofsToCheck: Number(proofs[0]?.value ?? 0),
    /*
     * The one thing on this screen somebody else is waiting on. Everything
     * else the portal asks for can wait until the family is ready; a date
     * the home cannot confirm is holding up the florist, the printer and
     * the church, so the hub puts this above all of it.
     */
    awaitingServiceChoice: isAwaitingChoice(row, openOffers, settled),
    aftercare: aftercare[0]
      ? {
          ...aftercare[0],
          contactName: contact.name,
          // The family is shown when the check-ins would land, so they are
          // consenting to something specific rather than to "emails".
          deliveries: deliveries.map(toDeliveryJson),
          // The extra notes the home offers, with their dates, so opting in
          // is to something specific too. Only while undecided.
          touchpointsOffered:
            aftercare[0].status === "pending"
              ? touchpointDates(
                  row,
                  aftercare[0].startsAt,
                  offeredTouchpoints(home),
                )
              : [],
          smsAvailable: isSmsConfigured(),
        }
      : null,
  });
});

export default router;

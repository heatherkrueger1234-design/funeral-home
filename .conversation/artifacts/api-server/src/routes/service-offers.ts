import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  caseServiceOffersTable,
  MAX_SERVICE_OFFERS,
} from "@workspace/db";
import { CreateServiceOfferBody } from "@workspace/api-zod";
import { badRequest, HttpError, parseBody, parseId } from "../lib/http";
import { tenant } from "../middleware/require-auth";
import {
  assertUnanswered,
  chooseOffer,
  offersForCase,
  toOfferJson,
} from "../lib/service-offers";
import { loadCase } from "./cases";

/**
 * The director's half of offering a family a time.
 *
 * What a director does here they could already do on the telephone; what they
 * could not do was leave a record of it that the family can read at midnight
 * and answer without ringing back. Nothing in this file books anything — see
 * `schema/service-offers.ts` for why that restraint is deliberate.
 */

const router: IRouter = Router();

router.get("/cases/:caseId/service-offers", async (req, res) => {
  const row = await loadCase(req, req.params.caseId);

  res.json(await offersForCase(row.id));
});

router.post("/cases/:caseId/service-offers", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const values = parseBody(CreateServiceOfferBody, req.body);

  await assertUnanswered(row.id);

  /*
   * A time that has already gone is a typo, not an offer — a director typing
   * last year on a date field, which is one keystroke. Refused here rather
   * than at the point of choosing, because by then it is in front of a
   * family as something they are being asked to agree to.
   *
   * Deliberately only on the way in. `confirm` below takes no date at all and
   * still works on a time that has since passed, because recording what a
   * family already agreed to is a different act from proposing it, and a
   * director catching up on paperwork after the service must still be able
   * to say which one was taken.
   */
  if (values.startsAt.getTime() <= Date.now()) {
    throw badRequest("That time has already passed. Check the date.");
  }

  /*
   * A ceiling, and a low one. Three dates is a decision; eight is a form to
   * fill in, and the family it is hardest on is the one this feature exists
   * for — people who cannot hold a schedule in their head this week.
   */
  const [count] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(caseServiceOffersTable)
    .where(eq(caseServiceOffersTable.caseId, row.id));

  if ((count?.value ?? 0) >= MAX_SERVICE_OFFERS) {
    throw badRequest(
      `That is ${MAX_SERVICE_OFFERS} options already. Withdraw one before adding another — a family choosing between more than a few is being given work rather than a choice.`,
    );
  }

  const [created] = await db
    .insert(caseServiceOffersTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      startsAt: values.startsAt,
      location: values.location?.trim() || null,
      note: values.note?.trim() || null,
      position: count?.value ?? 0,
    })
    .returning();

  res.status(201).json(toOfferJson(created!));
});

/**
 * The family rang instead of tapping, which is most of them over sixty.
 *
 * Deliberately the same code path as the family choosing it, so the schedule
 * gets built either way. `chosenByContactId` stays null: the home answered on
 * their behalf, and the portal says so rather than attributing a tap to a
 * daughter who never made one.
 */
router.post("/cases/:caseId/service-offers/:offerId/confirm", async (req, res) => {
  const row = await loadCase(req, req.params.caseId);
  const offerId = parseId(req.params.offerId);

  const result = await chooseOffer(row, offerId, { contactId: null });

  res.json({
    offer: toOfferJson(result.offer),
    serviceAt: result.serviceAt,
    scheduleCreated: result.schedule.created,
    scheduleMoved: result.schedule.moved,
  });
});

router.delete("/service-offers/:offerId", async (req, res) => {
  const home = tenant(req);
  const offerId = parseId(req.params.offerId);

  /*
   * Scoped on the home rather than on a case id from the path, like every
   * other by-id route here: the id is the only thing the client supplied, so
   * the tenant filter is the whole of what stops it reaching another home's
   * case.
   */
  const [offer] = await db
    .select()
    .from(caseServiceOffersTable)
    .where(
      and(
        eq(caseServiceOffersTable.id, offerId),
        eq(caseServiceOffersTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  if (!offer) throw new HttpError(404, "No such offered time.");

  if (offer.chosenAt !== null) {
    throw new HttpError(
      409,
      "That is the time the family chose. Change the service date on the case instead — withdrawing it would leave them believing it is settled.",
    );
  }

  await db
    .delete(caseServiceOffersTable)
    .where(eq(caseServiceOffersTable.id, offer.id));

  res.status(204).end();
});

export default router;

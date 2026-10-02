import {
  CompleteFamilyDeadlineBody,
  PostFamilyMessageBody,
} from "@workspace/api-zod";
import {
  caseDeadlinesTable,
  caseMessagesTable,
  caseServiceOffersTable,
  casesTable,
  db,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  badRequest,
  HttpError,
  parseBody,
  parseId,
  requireRow,
} from "../../lib/http";
import { isWithinOfficeHours } from "../../lib/office-hours";
import {
  chooseOffer,
  chosenOffer,
  offersForCase,
} from "../../lib/service-offers";
import { buildThread, isThreadLocked, markRead } from "../../lib/thread";
import {
  familyCase,
  familyContact,
  familyHome,
} from "../../middleware/require-family";
import { deadlinesForCase } from "../deadlines";

/** The one thread, the service date and the timeline. Mounted under /family; see `index.ts`. */
const router: IRouter = Router();

/* ------------------------------------------------------------ messages --- */

router.get("/messages", async (req, res) => {
  const row = familyCase(req);
  const home = familyHome(req);

  const thread = await buildThread({ case: row, home });

  await markRead(row.id, "family").catch((err: unknown) => {
    req.log?.warn({ err }, "Could not mark home messages read");
  });

  res.json(thread);
});

router.post("/messages", async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);
  const home = familyHome(req);
  const values = parseBody(PostFamilyMessageBody, req.body);

  const body = values.body.trim();
  if (!body) throw badRequest("A message can't be empty.");

  if (isThreadLocked(row)) {
    throw new HttpError(
      409,
      "This conversation has been closed. Please call the funeral home if you need them.",
    );
  }

  const now = new Date();
  // Delivered whatever the hour — see `lib/office-hours.ts`. All that is
  // recorded is that it was written out of hours, so the portal can say
  // honestly when it will be read.
  const outsideHours = isWithinOfficeHours(home, now) ? null : now;

  const [created] = await db
    .insert(caseMessagesTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      authorContactId: contact.id,
      body,
      sentOutsideOfficeHours: outsideHours,
    })
    .returning();

  await markRead(row.id, "family", now).catch((err: unknown) => {
    req.log?.warn({ err }, "Could not mark home messages read");
  });

  res.status(201).json({
    id: created!.id,
    caseId: created!.caseId,
    body: created!.body,
    authorSide: "family" as const,
    authorName: contact.name,
    authorTitle: contact.relationship,
    sentOutsideOfficeHours: outsideHours !== null,
    readAt: created!.readAt,
    createdAt: created!.createdAt,
  });
});

/* ----------------------------------------------------- the service date --- */

/**
 * The one date a family sets on anything.
 *
 * Everywhere else in this portal the family is answering questions about the
 * past — who their mother was, which photographs, which hymn. This is the
 * single place they decide something about the week ahead, and it is the
 * decision the florist, the printer and the church are all waiting on.
 *
 * No case id in the path, like every route in this file: the token names
 * exactly one case, so there is nothing for anybody to tamper with.
 */
async function serviceOffersPayload(
  row: typeof casesTable.$inferSelect,
  home: { phone: string | null },
) {
  const [offers, chosen] = await Promise.all([
    offersForCase(row.id),
    chosenOffer(row.id),
  ]);

  return {
    offers,
    chosenOfferId: chosen?.id ?? null,
    // The confirmed time, which the home may have set directly without ever
    // offering anything. A family looking at this has nothing left to answer.
    serviceAt: row.serviceAt,
    serviceLocation: row.serviceLocation,
    // Shown beside a settled choice, because the way to move an agreed
    // funeral is to speak to a person, not to tap a different button.
    homePhone: home.phone,
  };
}

router.get("/service-offers", async (req, res) => {
  const row = familyCase(req);
  const home = familyHome(req);

  res.json(await serviceOffersPayload(row, home));
});

router.post("/service-offers/:offerId/choose", async (req, res) => {
  const row = familyCase(req);
  const home = familyHome(req);
  const contact = familyContact(req);
  const offerId = parseId(req.params.offerId);

  /*
   * A closed case is over. The link stays live for a fortnight after the
   * service so a family can still look at the photographs, and a tab left
   * open on this screen through the funeral itself must not be able to
   * rewrite the date of a service that has already happened and rebuild a
   * timeline behind it.
   */
  if (row.status === "closed") {
    throw new HttpError(
      409,
      "This service is settled. Please call the funeral home if something needs to change.",
    );
  }

  /*
   * Two more ways the family's screen and this route used to disagree.
   *
   * A home can set the service date directly, having offered times earlier
   * or offered some since; the portal then shows the date as settled and no
   * buttons, so a choice arriving here is from a stale tab and would quietly
   * move a funeral the director has already booked with the church. And a
   * time that has already passed is not a choice at all — picking it would
   * set a service date in the past and build a timeline of tasks all overdue.
   * Both are refused in the same words as a second chooser, because the
   * answer to all three is the same: ring the home.
   */
  if (row.serviceAt !== null) {
    throw new HttpError(
      409,
      "The service time is already settled. Please call the funeral home if it needs to change.",
    );
  }

  const [offer] = await db
    .select({ startsAt: caseServiceOffersTable.startsAt })
    .from(caseServiceOffersTable)
    .where(
      and(
        eq(caseServiceOffersTable.id, offerId),
        eq(caseServiceOffersTable.caseId, row.id),
      ),
    )
    .limit(1);

  if (offer && offer.startsAt.getTime() <= Date.now()) {
    throw new HttpError(
      409,
      "That time has already passed. Please call the funeral home to settle another.",
    );
  }

  await chooseOffer(row, offerId, { contactId: contact.id });

  /*
   * Re-read rather than patching the request's copy: choosing writes both the
   * service date and, when the option carried one, the location. A family
   * handed back the copy this request started with would see the time they
   * did not pick for as long as the screen stayed open.
   */
  const [fresh] = await db
    .select()
    .from(casesTable)
    .where(eq(casesTable.id, row.id))
    .limit(1);

  res.json(
    await serviceOffersPayload(
      requireRow(fresh, "That case could not be found."),
      home,
    ),
  );
});

/* ----------------------------------------------------------- deadlines --- */

router.get("/deadlines", async (req, res) => {
  const row = familyCase(req);
  res.json(await deadlinesForCase(row.id, row.funeralHomeId));
});

router.post("/deadlines/:deadlineId", async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);
  const id = parseId(req.params.deadlineId);
  const { completed } = parseBody(CompleteFamilyDeadlineBody, req.body);

  const [deadline] = await db
    .select()
    .from(caseDeadlinesTable)
    .where(
      and(eq(caseDeadlinesTable.id, id), eq(caseDeadlinesTable.caseId, row.id)),
    )
    .limit(1);

  const found = requireRow(deadline, "That could not be found.");

  if (found.isEvent) {
    throw badRequest("That's when something happens, not something to do.");
  }

  // The home ticked this off — the plot confirmed, the permit filed. A tap
  // on a family's phone must not quietly put it back on the director's list.
  if (!completed && found.completedByUserId !== null) {
    throw new HttpError(
      409,
      "The funeral home marked this one done. If it isn't, send them a message.",
    );
  }

  await db
    .update(caseDeadlinesTable)
    .set(
      completed
        ? {
            completedAt: new Date(),
            completedByContactId: contact.id,
            completedByUserId: null,
            updatedAt: new Date(),
          }
        : {
            completedAt: null,
            completedByContactId: null,
            completedByUserId: null,
            updatedAt: new Date(),
          },
    )
    .where(eq(caseDeadlinesTable.id, found.id));

  const all = await deadlinesForCase(row.id, row.funeralHomeId);
  res.json(all.find((entry) => entry.id === found.id));
});

export default router;

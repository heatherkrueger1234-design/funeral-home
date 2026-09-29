import {
  db,
  funeralHomesTable,
  homeLicensureTable,
  LICENCE_STANDINGS,
  licensureReminders,
  PRACTITIONER_ROLES,
  practitionerLicencesTable,
  SMS_REGISTRATION_STATUSES,
  SMS_TOLL_FREE_STATUSES,
  type FuneralHome,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { HttpError, parseBody, parseId, requireRow } from "../../lib/http";
import {
  createSubaccount,
  describeSmsRoute,
  fetchRegistrationStatus,
  isSmsConfigured,
  SmsNotSentError,
  smsRouteFor,
} from "../../lib/sms";
import {
  actor,
  platformFindHomeForChange,
  platformLicensureFor,
  platformLoadHome,
  recordPlatformAccess,
} from "./shared";

/** Licensure, practitioners and each home's texting setup. */
const router: IRouter = Router();

/* ----------------------------------------------------------- licensure -- */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Please give a date as YYYY-MM-DD");

const LicensureBody = z.object({
  doraRegistrationNumber: z.string().trim().max(60).nullish(),
  registeredServices: z
    .array(z.string().trim().min(1).max(120))
    .max(40)
    .optional(),
  designeeName: z.string().trim().max(160).nullish(),
  designeeTitle: z.string().trim().max(160).nullish(),
  beganBusinessOn: isoDate.nullish(),
  registrationRenewsOn: isoDate.nullish(),
  servicesChangedOn: isoDate.nullish(),
  amendmentFiledOn: isoDate.nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

router.put("/admin/homes/:homeId/licensure", async (req, res) => {
  const who = actor(req);
  const values = parseBody(LicensureBody, req.body);
  const home = await platformLoadHome(
    who,
    parseId(req.params.homeId),
    "home.licensure.update",
  );

  // Upserted rather than created-then-updated: there is exactly one row per
  // home, and the first time anyone types a registration number is not a
  // different operation from the second time.
  const [saved] = await db
    .insert(homeLicensureTable)
    .values({ funeralHomeId: home.id, ...values })
    .onConflictDoUpdate({
      target: homeLicensureTable.funeralHomeId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();

  const practitioners = (await platformLicensureFor(home.id)).practitioners;

  res.json({
    licensure: saved!,
    practitioners,
    reminders: licensureReminders(saved!, practitioners),
  });
});

const PractitionerBody = z.object({
  personName: z.string().trim().min(1).max(160),
  role: z.enum(PRACTITIONER_ROLES),
  standing: z.enum(LICENCE_STANDINGS),
  licenceNumber: z.string().trim().max(60).nullish(),
  expiresOn: isoDate.nullish(),
});

router.post("/admin/homes/:homeId/practitioners", async (req, res) => {
  const who = actor(req);
  const values = parseBody(PractitionerBody, req.body);
  const home = await platformLoadHome(
    who,
    parseId(req.params.homeId),
    "home.practitioner.update",
    `added ${values.personName}`,
  );

  const [created] = await db
    .insert(practitionerLicencesTable)
    .values({ funeralHomeId: home.id, ...values })
    .returning();

  res.status(201).json(created!);
});

/**
 * Load a practitioner row *and* prove it belongs to the home named in the
 * path. Scoping on both is the same discipline as every staff route, and it
 * matters more here, not less: the id in the URL is the only thing stopping
 * an edit meant for one customer landing on another.
 */
async function loadPractitioner(homeId: number, rawId: string | undefined) {
  const [row] = await db
    .select()
    .from(practitionerLicencesTable)
    .where(
      and(
        eq(practitionerLicencesTable.id, parseId(rawId)),
        eq(practitionerLicencesTable.funeralHomeId, homeId),
      ),
    )
    .limit(1);

  return requireRow(row, "That person could not be found at this home.");
}

router.put(
  "/admin/homes/:homeId/practitioners/:licenceId",
  async (req, res) => {
    const who = actor(req);
    const values = parseBody(PractitionerBody, req.body);
    const home = await platformLoadHome(
      who,
      parseId(req.params.homeId),
      "home.practitioner.update",
      `updated ${values.personName}`,
    );

    const existing = await loadPractitioner(home.id, req.params.licenceId);

    const [updated] = await db
      .update(practitionerLicencesTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(practitionerLicencesTable.id, existing.id))
      .returning();

    res.json(updated!);
  },
);

router.delete(
  "/admin/homes/:homeId/practitioners/:licenceId",
  async (req, res) => {
    const who = actor(req);
    const home = await platformLoadHome(
      who,
      parseId(req.params.homeId),
      "home.practitioner.update",
      "removed a practitioner",
    );

    const existing = await loadPractitioner(home.id, req.params.licenceId);

    await db
      .delete(practitionerLicencesTable)
      .where(eq(practitionerLicencesTable.id, existing.id));

    res.status(204).end();
  },
);

/* ------------------------------------------------------------ texting -- */

/**
 * A home's own texting sender: its Twilio subaccount, the 10DLC brand and
 * campaign on its messaging service, and a toll-free fallback. Statuses are
 * refreshed from Twilio where it can say, and otherwise set here by hand
 * from what the Twilio console shows.
 */
function smsSetup(home: FuneralHome) {
  const route = smsRouteFor(home);
  return {
    subaccountSid: home.smsSubaccountSid,
    messagingServiceSid: home.smsMessagingServiceSid,
    brandRegistrationSid: home.smsBrandRegistrationSid,
    brandStatus: home.smsBrandStatus,
    campaignStatus: home.smsCampaignStatus,
    tollFreeNumber: home.smsTollFreeNumber,
    tollFreeStatus: home.smsTollFreeStatus,
    checkedAt: home.smsStatusCheckedAt,
    sendingFrom: route?.kind ?? null,
    description: describeSmsRoute(home),
  };
}

const sid = (prefix: string) =>
  z
    .string()
    .trim()
    .regex(
      new RegExp(`^${prefix}[0-9a-fA-F]{32}$`),
      `Expected a ${prefix}… SID`,
    );

const SmsSetupBody = z.object({
  subaccountSid: sid("AC").nullish(),
  messagingServiceSid: sid("MG").nullish(),
  brandRegistrationSid: sid("BN").nullish(),
  brandStatus: z.enum(SMS_REGISTRATION_STATUSES).optional(),
  campaignStatus: z.enum(SMS_REGISTRATION_STATUSES).optional(),
  tollFreeNumber: z
    .string()
    .trim()
    .regex(
      /^\+1(800|833|844|855|866|877|888)\d{7}$/,
      "A US toll-free number in +1 format",
    )
    .nullish(),
  tollFreeStatus: z.enum(SMS_TOLL_FREE_STATUSES).optional(),
});

router.get("/admin/homes/:homeId/sms", async (req, res) => {
  const home = await platformLoadHome(actor(req), parseId(req.params.homeId));
  res.json(smsSetup(home));
});

router.put("/admin/homes/:homeId/sms", async (req, res) => {
  const who = actor(req);
  const values = parseBody(SmsSetupBody, req.body);
  const home = await platformLoadHome(
    who,
    parseId(req.params.homeId),
    "home.sms.update",
  );

  const [updated] = await db
    .update(funeralHomesTable)
    .set({
      ...(values.subaccountSid !== undefined
        ? { smsSubaccountSid: values.subaccountSid }
        : {}),
      ...(values.messagingServiceSid !== undefined
        ? { smsMessagingServiceSid: values.messagingServiceSid }
        : {}),
      ...(values.brandRegistrationSid !== undefined
        ? { smsBrandRegistrationSid: values.brandRegistrationSid }
        : {}),
      ...(values.brandStatus ? { smsBrandStatus: values.brandStatus } : {}),
      ...(values.campaignStatus
        ? { smsCampaignStatus: values.campaignStatus }
        : {}),
      ...(values.tollFreeNumber !== undefined
        ? { smsTollFreeNumber: values.tollFreeNumber }
        : {}),
      ...(values.tollFreeStatus
        ? { smsTollFreeStatus: values.tollFreeStatus }
        : {}),
      smsStatusCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();

  res.json(smsSetup(updated!));
});

/** Create the home's own subaccount, once. */
router.post("/admin/homes/:homeId/sms/subaccount", async (req, res) => {
  const who = actor(req);
  const home = await platformFindHomeForChange(parseId(req.params.homeId));
  if (home.smsSubaccountSid)
    throw new HttpError(409, "This home already has a subaccount.");
  if (!isSmsConfigured())
    throw new HttpError(409, "Twilio is not configured on this deployment.");
  await recordPlatformAccess(
    who,
    "home.sms.update",
    home,
    "created a Twilio subaccount",
  );

  let subaccountSid: string;
  try {
    subaccountSid = await createSubaccount(`Continuum ${home.id} ${home.name}`);
  } catch (error) {
    if (error instanceof SmsNotSentError)
      throw new HttpError(502, error.message);
    throw error;
  }

  const [updated] = await db
    .update(funeralHomesTable)
    .set({ smsSubaccountSid: subaccountSid, updatedAt: new Date() })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();
  res.json(smsSetup(updated!));
});

/** Ask Twilio where the 10DLC brand and campaign stand. */
router.post("/admin/homes/:homeId/sms/refresh", async (req, res) => {
  const home = await platformLoadHome(
    actor(req),
    parseId(req.params.homeId),
    "home.sms.update",
    "refreshed texting registration",
  );
  const status = await fetchRegistrationStatus(home);
  const [updated] = await db
    .update(funeralHomesTable)
    .set({
      ...(status.brand ? { smsBrandStatus: status.brand } : {}),
      ...(status.campaign ? { smsCampaignStatus: status.campaign } : {}),
      smsStatusCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();
  res.json(smsSetup(updated!));
});

export default router;

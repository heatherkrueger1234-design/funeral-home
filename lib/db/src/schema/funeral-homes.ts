import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A funeral home. The tenant, and the thing that pays the monthly bill.
 *
 * Every other table in this database is reachable from a row here, and every
 * query in the API filters on `funeralHomeId` before it filters on anything
 * else. That is the whole security model: one home must never see another
 * home's families, and the way that is guaranteed is that the tenant id comes
 * from the signed-in staff member's row — never from the request.
 *
 * The branding columns are not decoration. The pitch to a director is that
 * the family experience looks like it came from *their* home, and that the
 * grief aftercare arrives signed "provided in care with Horan & McConaty".
 * A logo and an accent colour are what make that true.
 */
export const funeralHomesTable = pgTable(
  "funeral_homes",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    /**
     * Used in the family-facing URL and in the aftercare sender name. Stored
     * lower-cased and unique so it can be relied on as an identifier.
     */
    slug: text("slug").notNull(),

    /* ------------------------------------------------------------ brand */

    logoUploadId: integer("logo_upload_id"),
    /** Hex, e.g. "#1f4e46". Rendered into the family portal's header. */
    accentColor: text("accent_color").notNull().default("#1f4e46"),

    /* ------------------------------------------------- contact + hours */

    phone: text("phone"),
    /**
     * The number a family is told to ring when it genuinely cannot wait —
     * a death in the night, a removal. Kept separate from `phone` because
     * the whole point of office hours is to route non-urgent questions away
     * from the director's cell phone and urgent ones straight to a human.
     */
    urgentPhone: text("urgent_phone"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),

    /**
     * Office hours, as minutes from midnight in `timezone`. Minutes rather
     * than a time column because the only arithmetic ever done with them is
     * "is now inside the window", and integers make that a comparison rather
     * than a date-library problem.
     *
     * These do not gate anything. A family can write a message at 2am and it
     * will be delivered; what changes is that the portal tells them plainly
     * when it will be read, and offers the urgent line if it cannot wait.
     * Silently holding a message would be worse than the midnight text this
     * feature exists to prevent.
     */
    officeOpensMinute: integer("office_opens_minute").notNull().default(8 * 60),
    officeClosesMinute: integer("office_closes_minute")
      .notNull()
      .default(17 * 60),
    timezone: text("timezone").notNull().default("America/Denver"),

    /* ------------------------------------------------------- aftercare */

    /**
     * Whether closing a case hands the family on to the grief aftercare.
     * On by default: it is the feature that costs the home nothing and makes
     * them look most thoughtful, and a home that does not want it can say so.
     */
    aftercareEnabled: boolean("aftercare_enabled").notNull().default(true),
    /**
     * How the aftercare signs itself. Defaults to the home's name at send
     * time when blank — held separately because "Horan & McConaty Funeral
     * Service" is a legal name and "Horan & McConaty" is what a grieving
     * family should read at the bottom of a check-in.
     */
    aftercareSenderName: text("aftercare_sender_name"),

    /* ---------------------------------------------------- subscription */

    /**
     * Deliberately coarse. Billing lives in Stripe; this column only answers
     * the question the app actually asks, which is whether to let this home
     * open new cases. Anything finer would be a second source of truth for
     * money, and it would be the wrong one.
     */
    subscriptionStatus: text("subscription_status").notNull().default("trial"),
    trialEndsAt: timestamp("trial_ends_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("funeral_homes_slug_unique").on(table.slug)],
);

export const SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "past_due",
  "canceled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const insertFuneralHomeSchema = createInsertSchema(
  funeralHomesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFuneralHome = z.infer<typeof insertFuneralHomeSchema>;
export type FuneralHome = typeof funeralHomesTable.$inferSelect;

/**
 * What a family is allowed to know about the home whose portal they are in:
 * enough to recognise it and to reach it, and nothing about its account.
 */
export type PublicFuneralHome = Pick<
  FuneralHome,
  | "name"
  | "slug"
  | "accentColor"
  | "logoUploadId"
  | "phone"
  | "urgentPhone"
  | "officeOpensMinute"
  | "officeClosesMinute"
  | "timezone"
>;

export function toPublicFuneralHome(home: FuneralHome): PublicFuneralHome {
  return {
    name: home.name,
    slug: home.slug,
    accentColor: home.accentColor,
    logoUploadId: home.logoUploadId,
    phone: home.phone,
    urgentPhone: home.urgentPhone,
    officeOpensMinute: home.officeOpensMinute,
    officeClosesMinute: home.officeClosesMinute,
    timezone: home.timezone,
  };
}

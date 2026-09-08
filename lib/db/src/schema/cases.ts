import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { funeralHomesTable } from "./funeral-homes";
import { usersTable } from "./users";

/**
 * One death, and everything the home and the family have to get through
 * together because of it.
 *
 * The name is the industry's own: directors say "case", and a product sold to
 * directors should speak their language rather than teach them ours. It is
 * deliberately *not* a case-management system — there is no price list, no
 * invoice, no contract, no venue booking here, and that omission is a product
 * decision rather than a gap. Homes already own systems for those, the FTC
 * Funeral Rule governs how prices must be disclosed, and cemeteries and
 * churches keep their own calendars. This table holds the collaboration with
 * the family, which is the part nobody has built.
 *
 * What lives here is only the confirmed shape of the service, so the family
 * can be shown it. Changing it here does not move anything in the world.
 */
export const casesTable = pgTable(
  "cases",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /* --------------------------------------------------------- the person */

    decedentFirstName: text("decedent_first_name").notNull(),
    decedentLastName: text("decedent_last_name").notNull(),
    /** What they were actually called, when it is not their first name. */
    decedentPreferredName: text("decedent_preferred_name"),
    dateOfBirth: timestamp("date_of_birth"),
    dateOfDeath: timestamp("date_of_death"),

    /**
     * The portrait: the one photograph that ends up on the card, the register
     * book and the front of the slideshow. A pointer into `case_photos`
     * rather than a copy, so choosing it cannot orphan the crop stored there.
     */
    portraitPhotoId: integer("portrait_photo_id"),

    /**
     * The photo handed to whoever does hair and cosmetics.
     *
     * A different photograph from the portrait, and the distinction is not
     * cosmetic in the trivial sense. The portrait is the picture the family
     * loves -- often thirty years old, often three-quarter profile, often
     * the one where the light is beautiful. What the preparation room needs
     * is a clear, recent, front-on face: how they parted their hair, whether
     * they wore lipstick, which side the glasses sat.
     *
     * Asking for it explicitly is also the only reliable way to get it. A
     * director who has to ring the daughter to ask "do you have a photo of
     * how she did her hair" is making a phone call nobody wants to make.
     */
    referencePhotoId: integer("reference_photo_id"),

    /* ------------------------------------------------------- the service */

    /**
     * Confirmed, not proposed. The family is shown this as fact, so a home
     * that writes a time in here before the church has confirmed it will have
     * a family arriving at the wrong hour. Nullable until it is real.
     */
    serviceAt: timestamp("service_at"),
    serviceLocation: text("service_location"),

    /**
     * Where the family is, for finding anything local to them.
     *
     * The family's own ZIP rather than the home's, because a daughter
     * arranging her mother's funeral from two states away needs monument
     * companies near the cemetery, and a home whose families are all local
     * loses nothing by the distinction.
     */
    postalCode: text("postal_code"),
    serviceNotes: text("service_notes"),

    /**
     * Who the family should picture when the portal says "your director".
     * Nullable because a case is often opened by whoever took the call at
     * 3am, before anyone knows who will carry it.
     */
    leadDirectorId: integer("lead_director_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdByUserId: integer("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),

    /* ---------------------------------------------------------- lifecycle */

    /**
     * `intake` — opened, family not yet invited.
     * `active` — the family has a link and things are due.
     * `closed` — the service has happened and the logistics are finished.
     *
     * Closing is the event that matters commercially: it is what starts the
     * aftercare, and the aftercare is what the home is really buying.
     */
    status: text("status").notNull().default("intake"),
    closedAt: timestamp("closed_at"),

    /**
     * When the case chat stops accepting messages. Set when the case closes,
     * to the service date plus a fortnight.
     *
     * This is the column that protects the director six months later. Without
     * it, a case chat is a channel a family can reopen forever, and the
     * promise that this tool ends the endless thread quietly stops being
     * true. Stored rather than computed so a home can extend it for the one
     * family that genuinely needs longer.
     */
    messagesLockAt: timestamp("messages_lock_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("cases_funeral_home_id_idx").on(table.funeralHomeId, table.status),
    index("cases_service_at_idx").on(table.serviceAt),
  ],
);

export const CASE_STATUSES = ["intake", "active", "closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** How long after the service the chat stays open. */
export const MESSAGE_LOCK_DAYS = 14;

export const insertCaseSchema = createInsertSchema(casesTable).omit({
  id: true,
  funeralHomeId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCase = z.infer<typeof insertCaseSchema>;
export type Case = typeof casesTable.$inferSelect;

/** The name to print, preferring what they were actually called. */
export function decedentDisplayName(row: Case): string {
  const first = row.decedentPreferredName?.trim() || row.decedentFirstName;
  return `${first} ${row.decedentLastName}`.trim();
}

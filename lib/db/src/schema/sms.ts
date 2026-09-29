import { pgTable, text, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Numbers that replied STOP, per sender.
 *
 * `scope` is `home:<id>` for a home's own sender and `platform` for the
 * shared number, because a STOP applies to the number it was sent to.
 * Checked before every send, whatever the contact row says, so a number
 * typed again on a new case is still not texted. START deletes the row.
 */
export const smsOptOutsTable = pgTable(
  "sms_opt_outs",
  {
    id: serial("id").primaryKey(),
    /** E.164. */
    phone: text("phone").notNull(),
    scope: text("scope").notNull(),
    optedOutAt: timestamp("opted_out_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sms_opt_outs_phone_scope_unique").on(table.phone, table.scope)],
);

export type SmsOptOut = typeof smsOptOutsTable.$inferSelect;

export const SMS_REGISTRATION_STATUSES = ["none", "pending", "approved", "failed"] as const;
export const SMS_TOLL_FREE_STATUSES = ["none", "pending", "verified", "rejected"] as const;

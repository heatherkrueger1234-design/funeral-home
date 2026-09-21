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
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";

/**
 * One thread per case, and the reason a director will stop giving out their
 * cell number.
 *
 * What this replaces: a text thread with the daughter, a different one with
 * the son who disagrees with her, an email chain with the cousin arranging
 * flowers, and a voicemail. The director is the only person who can see all
 * four, so they become the switchboard, at midnight, on their own phone.
 *
 * Here there is one thread. Everyone on the family side can see it, which
 * settles the "who told you that?" arguments before they start, and the
 * director answers once.
 *
 * Two things make it humane rather than merely contained:
 *
 *  - **Office hours are shown, not enforced.** A message written at 2am is
 *    delivered at 2am. What the portal does is tell the family, before they
 *    send it, that it will be read from eight, and offer the 24-hour line if
 *    it truly cannot wait. Holding the message would be a lie about how
 *    quickly it was seen; this is the truth, said gently.
 *  - **The thread ends.** See `cases.messagesLockAt`. A fortnight after the
 *    service the thread locks, so the director is not still fielding
 *    logistics in March about a funeral in January.
 */
export const caseMessagesTable = pgTable(
  "case_messages",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /**
     * Exactly one of these is set, and which one is set is what decides
     * whether the message renders as the home or as the family. There is no
     * `authorType` column to disagree with them.
     */
    authorUserId: integer("author_user_id"),
    authorContactId: integer("author_contact_id"),

    body: text("body").notNull(),

    /**
     * Set when a message written outside office hours was written outside
     * office hours *at the time it was sent*. Recorded rather than recomputed
     * because a home can change its hours, and the honest answer to "was this
     * sent out of hours?" is the one that was true when the family hit send.
     */
    sentOutsideOfficeHours: timestamp("sent_outside_office_hours"),

    /**
     * When the other side read it. Coarse — one timestamp, not per-recipient
     * — because the question the director is actually answering is "has the
     * family seen my answer about the flowers", and six read receipts do not
     * answer it better than one.
     */
    readAt: timestamp("read_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("case_messages_case_id_idx").on(table.caseId, table.createdAt),
    index("case_messages_funeral_home_id_idx").on(table.funeralHomeId),
  ],
);

export const insertCaseMessageSchema = createInsertSchema(
  caseMessagesTable,
).omit({
  id: true,
  funeralHomeId: true,
  caseId: true,
  createdAt: true,
});
export type InsertCaseMessage = z.infer<typeof insertCaseMessageSchema>;
export type CaseMessage = typeof caseMessagesTable.$inferSelect;

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
import { casesTable } from "./cases";
import { usersTable } from "./users";

/**
 * Someone asking a home to open a file, when nobody has sent them a link.
 *
 * Until this existed the portal had exactly one way in: a token texted by a
 * director. That is right for the family the home already knows about, and a
 * dead end for the two other people who turn up.
 *
 * The first is a family whose person died an hour ago. They have found the
 * home's website at 2am, and what they want is to start putting things
 * somewhere — not to wait for the arrangement conference on Tuesday. Today
 * they get "this page needs your link" and go back to texting photographs to
 * whatever number they can find.
 *
 * The second is someone who is not bereaved at all: they are planning their
 * own funeral while well, which is a thing hundreds of thousands of people do
 * every year and the single largest source of pre-arranged business a home
 * has. They are the opposite of a grieving family in every way that matters
 * to the interface, and giving them a screen written for the bereaved is both
 * unkind and wrong.
 *
 * A request is *not* a case. An unauthenticated stranger cannot put a row in
 * a home's case list — that would make this an open spam relay into the one
 * screen a director works from all day. A director accepts it, and accepting
 * is what creates the case.
 */
export const intakeRequestsTable = pgTable(
  "intake_requests",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /**
     * Which of the two self-start doors this came through. It decides the
     * language on every screen that follows, and whether the case that gets
     * created is for someone who has died.
     */
    kind: text("kind").notNull(),

    /* --------------------------------------------------- who is asking */

    requesterName: text("requester_name").notNull(),
    requesterEmail: text("requester_email"),
    requesterPhone: text("requester_phone"),
    /**
     * Blank for a pre-need request, where the requester and the subject are
     * the same person. Kept as its own column rather than inferred, because
     * "I am arranging for my husband" and "I am arranging for myself" are
     * different sentences and a director reading the queue needs to see which.
     */
    relationship: text("relationship"),

    /* ------------------------------------------------ who it is about */

    subjectFirstName: text("subject_first_name").notNull(),
    subjectLastName: text("subject_last_name").notNull(),
    /**
     * Null on a pre-need request, and null on an at-need request from someone
     * who does not know it yet — which happens, and is not a reason to refuse
     * the form.
     */
    dateOfDeath: timestamp("date_of_death"),

    /** Whatever they wanted to say. Shown to the director, never published. */
    note: text("note"),

    /* ---------------------------------------------------------- lifecycle */

    /** `pending` — in the director's queue.
     *  `accepted` — a case exists; `caseId` points at it.
     *  `declined` — the home said no, or it was a duplicate or a mistake. */
    status: text("status").notNull().default("pending"),
    reviewedByUserId: integer("reviewed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    reviewedAt: timestamp("reviewed_at"),
    caseId: integer("case_id").references(() => casesTable.id, {
      onDelete: "set null",
    }),

    /**
     * Kept so the same person filling the form twice — which a distressed
     * person does — can be spotted, and so abuse has something to group by.
     * Not shown to the director.
     */
    submittedFromIp: text("submitted_from_ip"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("intake_requests_home_status_idx").on(
      table.funeralHomeId,
      table.status,
    ),
    index("intake_requests_created_idx").on(table.createdAt),
  ],
);

export const INTAKE_KINDS = ["at_need", "pre_need"] as const;
export type IntakeKind = (typeof INTAKE_KINDS)[number];

export const INTAKE_STATUSES = ["pending", "accepted", "declined"] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export const insertIntakeRequestSchema = createInsertSchema(
  intakeRequestsTable,
).omit({
  id: true,
  funeralHomeId: true,
  status: true,
  reviewedByUserId: true,
  reviewedAt: true,
  caseId: true,
  submittedFromIp: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertIntakeRequest = z.infer<typeof insertIntakeRequestSchema>;
export type IntakeRequest = typeof intakeRequestsTable.$inferSelect;

/**
 * How many requests one home will take from one address in an hour.
 *
 * Low, because the honest use is one person filling in one form once. The
 * cost of getting this wrong in the generous direction is a director opening
 * their queue to four hundred fake dead people on the morning of a funeral.
 */
export const INTAKE_REQUESTS_PER_IP_PER_HOUR = 5;

/** And how many a home will take in total in an hour, from anyone. */
export const INTAKE_REQUESTS_PER_HOME_PER_HOUR = 30;

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { familyContactsTable } from "./family-contacts";
import { funeralHomesTable } from "./funeral-homes";
import { uploadsTable } from "./uploads";
import { usersTable } from "./users";

/**
 * The home's own standing documents, and the record of who was shown which.
 *
 * A privacy notice, a price disclosure, the terms a family agrees to when
 * they hand over photographs. Three properties decide the shape, and all
 * three come from the same place — the only reason anybody cares about these
 * rows is a question asked months later, by a regulator or a lawyer or a
 * family: *what did you show them, and when?*
 *
 *  1. **Versioned, and versions are immutable.** A published version is never
 *     edited. A home changing a paragraph publishes a new version, and the
 *     old one stays exactly as some family read it. A record of "what they
 *     were shown" that points at an editable document records nothing.
 *  2. **The disclosure is per person, not per case.** A daughter who read the
 *     privacy notice does not mean her brother did.
 *  3. **Nothing is auto-deleted, ever.** Retention here is the home's legal
 *     call, and this is precisely the kind of row a home's insurer will one
 *     day be glad still exists. See `RETENTION.md`.
 *
 * What is deliberately absent: any document of ours. We supply no privacy
 * notice, no terms, no price disclosure text. A home's counsel writes them,
 * for the same reason we ship no legal form — see `forms.ts`.
 */

/**
 * What kind of document it is.
 *
 * `price_disclosure` is the home's own written disclosures — the paragraphs
 * the FTC Funeral Rule requires on a General Price List. The price *list*
 * itself is the storefront's, not this table's; what lives here is the prose
 * around it that the home's attorney wrote and wants versioned.
 */
export const POLICY_KINDS = [
  "price_disclosure",
  "privacy",
  "terms",
  "other",
] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

export const homePoliciesTable = pgTable(
  "home_policies",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    kind: text("kind").notNull().default("other"),

    /** As the family will see it: "How we look after your photographs". */
    title: text("title").notNull(),

    /** One line under the title, in the portal. Optional. */
    note: text("note"),

    position: integer("position").notNull().default(0),

    /**
     * Withdrawn from the portal, not deleted. Every version stays readable
     * and every disclosure still points at the version it pointed at.
     */
    retiredAt: timestamp("retired_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("home_policies_home_idx").on(table.funeralHomeId, table.position)],
);

/**
 * One version of one document, frozen.
 *
 * There is no `updatedAt` here and that is the point: nothing edits a row in
 * this table after it is published. A home that wants different words gets a
 * new row with the next version number, and every disclosure already recorded
 * keeps pointing at the words that were actually on the screen.
 */
export const homePolicyVersionsTable = pgTable(
  "home_policy_versions",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    policyId: integer("policy_id")
      .notNull()
      .references(() => homePoliciesTable.id, { onDelete: "cascade" }),

    /** 1, 2, 3 — what a home says on the telephone, not a hash. */
    version: integer("version").notNull(),

    /** The words themselves. Plain text, kept as the home typed it. */
    body: text("body").notNull().default(""),

    /**
     * The home's own PDF, when they have one their counsel signed off.
     * Shown alongside the text rather than instead of it, because a PDF on a
     * phone is a pinch-and-drag and the text is readable.
     */
    sourceUploadId: integer("source_upload_id").references(() => uploadsTable.id, {
      onDelete: "set null",
    }),

    /** What changed, in the home's words. For the home's own records. */
    summary: text("summary"),

    publishedAt: timestamp("published_at").notNull().defaultNow(),
    publishedByUserId: integer("published_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("home_policy_versions_unique_idx").on(table.policyId, table.version),
    index("home_policy_versions_policy_idx").on(table.policyId, table.publishedAt),
  ],
);

/**
 * That this person was shown this version, at this moment.
 *
 * Written when the document renders, not when a button is pressed — the fact
 * worth recording is that the words were in front of them, and that becomes
 * true when the page shows them. The storefront records a price list being
 * opened the same way, and for the same reason.
 *
 * `acknowledgedAt` is separate and is only set where a home asks a family to
 * confirm they have read something. Being shown a privacy notice is not
 * agreeing to it, and collapsing the two would record a consent nobody gave.
 */
export const policyDisclosuresTable = pgTable(
  "policy_disclosures",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    versionId: integer("version_id")
      .notNull()
      .references(() => homePolicyVersionsTable.id, { onDelete: "cascade" }),
    contactId: integer("contact_id")
      .notNull()
      .references(() => familyContactsTable.id, { onDelete: "cascade" }),

    shownAt: timestamp("shown_at").notNull().defaultNow(),

    acknowledgedAt: timestamp("acknowledged_at"),
    /** Typed by them, kept verbatim, only where the home asked for it. */
    acknowledgedName: text("acknowledged_name"),
    /** "Who, what, when, from where", as Section 1 of `COLORADO.md` asks. */
    acknowledgedIp: text("acknowledged_ip"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("policy_disclosures_unique_idx").on(table.versionId, table.contactId),
    index("policy_disclosures_case_idx").on(table.caseId),
  ],
);

/* ------------------------------------------------------------- contracts -- */

export type HomePolicy = typeof homePoliciesTable.$inferSelect;
export type HomePolicyVersion = typeof homePolicyVersionsTable.$inferSelect;
export type PolicyDisclosure = typeof policyDisclosuresTable.$inferSelect;

export const policyKindSchema = z.enum(POLICY_KINDS);

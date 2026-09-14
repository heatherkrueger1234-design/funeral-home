import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";
import { usersTable } from "./users";
import { uploadsTable } from "./uploads";

/**
 * The home's own paperwork, and a family filling it in on a phone.
 *
 * Every funeral home has a folder of forms — a vital statistics worksheet, a
 * cremation authorisation, a release of effects, whatever their state and
 * their insurer require — and every one of those folders is different. So
 * this is not a fixed set of screens: a home uploads its own forms, names its
 * own boxes, and every family at that home gets the ones the home attached.
 *
 * Three tables, and the split matters:
 *
 *  - `home_forms` and `home_form_fields` are the blank form. They belong to
 *    the home and are edited by the home.
 *  - `case_form_answers` is one family's answers, one row per box. A row per
 *    box rather than a JSON blob per form, because the two questions that
 *    actually get asked are "which boxes are still empty" and "who answered
 *    this one" — and both are a `where` clause against rows and an unindexable
 *    scan against a blob.
 *
 * `answeredBy` is the column that makes pre-need worth anything. A box filled
 * in by the person themselves, four years before they died, has to be able to
 * say so — otherwise their family sits looking at a form that is mysteriously
 * already correct and has no idea whether to trust it.
 */

/** What kind of control a box is. Deliberately small; a form is not a UI. */
export const FORM_FIELD_KINDS = [
  "text",
  "textarea",
  "date",
  "number",
  "select",
  "checkbox",
  "signature",
] as const;
export type FormFieldKind = (typeof FORM_FIELD_KINDS)[number];

export const homeFormsTable = pgTable(
  "home_forms",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    name: text("name").notNull(),

    /** One line under the title: "Required to file the death certificate". */
    note: text("note"),

    /**
     * Whether every new case gets this form.
     *
     * A home's library outgrows what any one family needs — a veteran's
     * benefits form matters to one case in twenty. Detached forms stay in the
     * library and can be put on a single case by hand.
     */
    attachByDefault: boolean("attach_by_default").notNull().default(true),

    /**
     * Whether somebody arranging their own funeral is asked this.
     *
     * Off for anything that only makes sense once a person has died. A
     * cremation authorisation is signed by a living relative and cannot be
     * pre-answered; a vital statistics worksheet is almost entirely facts the
     * person knows better than anybody who will survive them.
     */
    inPreNeed: boolean("in_pre_need").notNull().default(false),

    /**
     * The original the home uploaded, kept alongside the boxes.
     *
     * The boxes are what a family fills in; this is the document a state
     * registrar, a coroner or a court expects to see, and throwing it away
     * because we extracted its fields would be throwing away the artefact.
     */
    sourceUploadId: integer("source_upload_id").references(() => uploadsTable.id, {
      onDelete: "set null",
    }),

    position: integer("position").notNull().default(0),
    retiredAt: timestamp("retired_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("home_forms_home_idx").on(table.funeralHomeId),
  ],
);

export const homeFormFieldsTable = pgTable(
  "home_form_fields",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    formId: integer("form_id")
      .notNull()
      .references(() => homeFormsTable.id, { onDelete: "cascade" }),

    /**
     * A stable handle for the box, unique within its form.
     *
     * Answers are stored against this rather than against the row id, so a
     * home can delete a mis-made box and re-add it without orphaning what a
     * family already typed.
     */
    key: text("key").notNull(),

    label: text("label").notNull(),
    kind: text("kind").notNull().default("text"),

    /** For `select`. Stored newline-separated, which is how it is edited. */
    options: text("options"),

    /** Under the box, in smaller type: "Not 'retired' — what they did." */
    help: text("help"),

    /**
     * Required to consider the form finished — not required to save.
     *
     * Nothing on the family surface ever refuses a partial save. A form that
     * will not let go of a grieving person until they have found their
     * mother's maiden name is a form they abandon on a phone at midnight.
     */
    required: boolean("required").notNull().default(false),

    /**
     * Whether this box may hold something a funeral home's insurer would
     * rather it did not.
     *
     * Set on social security numbers, policy numbers and anything else that
     * belongs in the encrypted columns. The API refuses to store a value for
     * a sensitive box in the clear, and `RETENTION.md` counts them.
     */
    sensitive: boolean("sensitive").notNull().default(false),

    position: integer("position").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("home_form_fields_form_idx").on(table.formId, table.position),
    uniqueIndex("home_form_fields_key_idx").on(table.formId, table.key),
  ],
);

/** Which of the home's forms are on this particular case. */
export const caseFormsTable = pgTable(
  "case_forms",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    formId: integer("form_id")
      .notNull()
      .references(() => homeFormsTable.id, { onDelete: "cascade" }),

    /** The family can see and fill it. Off while a director is preparing it. */
    sharedWithFamily: boolean("shared_with_family").notNull().default(true),

    completedAt: timestamp("completed_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("case_forms_unique_idx").on(table.caseId, table.formId),
    index("case_forms_case_idx").on(table.caseId),
  ],
);

/** Who put the answer there. See the note at the top of the file. */
export const ANSWER_SOURCES = ["family", "self", "staff"] as const;
export type AnswerSource = (typeof ANSWER_SOURCES)[number];

export const caseFormAnswersTable = pgTable(
  "case_form_answers",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    formId: integer("form_id")
      .notNull()
      .references(() => homeFormsTable.id, { onDelete: "cascade" }),

    /** `home_form_fields.key`, not its id. See that column's note. */
    fieldKey: text("field_key").notNull(),

    /**
     * What they wrote.
     *
     * Encrypted at rest when the field is marked `sensitive`, in the same
     * envelope format as everything else — `v1.iv.tag.ciphertext`, so
     * `isEncrypted` can tell without a schema lookup.
     */
    value: text("value").notNull().default(""),

    /** `family`, `self` (pre-need, by the person), or `staff`. */
    source: text("source").notNull().default("family"),

    /**
     * When a pre-need answer was written, which is not when the case was
     * opened and is usually years earlier. Shown to the family, because
     * "he answered this in 2022" is the difference between trusting it and
     * wondering who typed it.
     */
    answeredAt: timestamp("answered_at").notNull().defaultNow(),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("case_form_answers_unique_idx").on(
      table.caseId,
      table.formId,
      table.fieldKey,
    ),
    index("case_form_answers_case_idx").on(table.caseId),
  ],
);

/**
 * A box a director has sent back, and why.
 *
 * The feature this exists for: a director reads a half-finished form, sees
 * the one box the state will reject the certificate over, and needs to say so
 * to a family who is not going to read a voicemail. The note lands in the
 * family's form, at the blank, rather than anywhere else.
 *
 * Cleared by answering. Not by the director marking it resolved, because the
 * director is not the one who knows when it is done.
 */
export const caseFormFlagsTable = pgTable(
  "case_form_flags",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    formId: integer("form_id")
      .notNull()
      .references(() => homeFormsTable.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),

    /** In the director's own words. Shown to the family verbatim. */
    note: text("note").notNull(),

    raisedByUserId: integer("raised_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    clearedAt: timestamp("cleared_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("case_form_flags_unique_idx").on(
      table.caseId,
      table.formId,
      table.fieldKey,
    ),
    index("case_form_flags_case_idx").on(table.caseId),
  ],
);

/* ------------------------------------------------------------- contracts -- */

export const insertHomeFormSchema = createInsertSchema(homeFormsTable).omit({
  id: true,
  funeralHomeId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertHomeForm = z.infer<typeof insertHomeFormSchema>;
export type HomeForm = typeof homeFormsTable.$inferSelect;

export const insertHomeFormFieldSchema = createInsertSchema(homeFormFieldsTable)
  .omit({ id: true, funeralHomeId: true, formId: true, createdAt: true, updatedAt: true })
  .extend({ kind: z.enum(FORM_FIELD_KINDS) });
export type InsertHomeFormField = z.infer<typeof insertHomeFormFieldSchema>;
export type HomeFormField = typeof homeFormFieldsTable.$inferSelect;

export type CaseForm = typeof caseFormsTable.$inferSelect;
export type CaseFormAnswer = typeof caseFormAnswersTable.$inferSelect;
export type CaseFormFlag = typeof caseFormFlagsTable.$inferSelect;

/** `select` options as edited (newline-separated) and as used (a list). */
export function fieldOptions(field: Pick<HomeFormField, "options">): string[] {
  return (field.options ?? "")
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Is this form finished?
 *
 * Only `required` boxes count. A form is not unfinished because somebody left
 * the middle name of a stepfather blank, and reporting it as unfinished is how
 * a director stops trusting the indicator entirely.
 */
export function formIsComplete(
  fields: HomeFormField[],
  answers: Map<string, string>,
): boolean {
  return fields
    .filter((f) => f.required)
    .every((f) => (answers.get(f.key) ?? "").trim() !== "");
}

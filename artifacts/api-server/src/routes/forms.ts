import { Router, type IRouter, type Response } from "express";
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import {
  db,
  casesTable,
  caseAuthorizationConsentsTable,
  caseAuthorizationsTable,
  caseFormAnswersTable,
  caseFormFlagsTable,
  caseFormsTable,
  familyContactsTable,
  homeFormFieldsTable,
  homeFormsTable,
  homePoliciesTable,
  homePolicyVersionsTable,
  policyDisclosuresTable,
  deathCertificateFilingsTable,
  usersTable,
  vitalStatisticsTable,
  atLeast,
  blockingFields,
  certificateDueAt,
  certificationDueAt,
  decedentDisplayName,
  fieldOptions,
  formIsComplete,
  majorityRecorded,
  tierRequiresMajority,
  FORM_PREFILL_SOURCES,
  type Case,
  type CaseAuthorization,
  type FamilyAccessLevel,
  type FamilyContact,
  type FuneralHome,
  type HomeForm,
  type HomeFormField,
  type CaseForm,
  type CaseFormAnswer,
  type HomePolicyVersion,
  type DeathCertificateFiling,
} from "@workspace/db";
import { encrypt, decrypt } from "@workspace/db/crypto";
import {
  GetHomeFormsQueryParams,
  CreateHomeFormBody,
  UpdateHomeFormBody,
  SetHomeFormFieldsBody,
  AssignCaseFormBody,
  UpdateCaseFormBody,
  SetCaseFormAnswersBody,
  FlagCaseFormFieldBody,
  RecordCaseAuthorizationBody,
  VerifyCaseAuthorizationBody,
  AddAuthorizationConsentBody,
  UpdateDeathCertificateRecordBody,
  CreatePolicyBody,
  UpdatePolicyBody,
  PublishPolicyVersionBody,
  SetFamilyFormAnswersBody,
  AuthorizeFamilyFormBody,
  AcknowledgeFamilyPolicyBody,
} from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  HttpError,
  parseBody,
  parseId,
  parseQuery,
  requireRow,
} from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import {
  familyCase,
  familyContact,
  familyHome,
} from "../middleware/require-family";
import { requireFamilyAuthorization } from "../middleware/require-family-level";
import { esc, lines } from "../lib/print-render";
import { logger } from "../lib/logger";
import { loadCase } from "./cases";

/**
 * The home's own paperwork, and Colorado's 72-hour clock around it.
 *
 * Two sentences to read before the code, because they decide most of what is
 * and is not below.
 *
 * **We ship no legal form of our own.** Not a cremation authorization, not a
 * disposition authorization, not a vital statistics worksheet. A national
 * vendor shipping its own authorization form hands every home it sells to a
 * liability and hands every family a document nobody's counsel has read. What
 * is here fills in and routes forms the home wrote.
 *
 * **We file nothing.** There is no EDRS integration in this file and there
 * will not be one. SB 23-020 gives a home 72 hours from taking custody to
 * file a certificate of death with the State Registrar, and what this does is
 * get the director to that system with every box already answered. Every
 * certificate response carries `filingNotice` saying so, so that no screen
 * can render the clock without also saying who files it.
 */

const router: IRouter = Router();

/* --------------------------------------------------------------- loading -- */

async function loadHomeForm(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
): Promise<HomeForm> {
  const home = tenant(req);
  const id = parseId(rawId);

  const [row] = await db
    .select()
    .from(homeFormsTable)
    .where(
      and(eq(homeFormsTable.id, id), eq(homeFormsTable.funeralHomeId, home.id)),
    )
    .limit(1);

  return requireRow(row, "That form could not be found.");
}

/**
 * A form on a case, scoped to both the case and the home.
 *
 * Both predicates, always. The case id is checked by `loadCase` against the
 * signed-in home; this then checks the case form against the case. Naming
 * another case's form id returns a 404 rather than another family's answers.
 */
async function loadCaseForm(
  funeralHomeId: number,
  caseId: number,
  rawId: string | undefined,
): Promise<{ caseForm: CaseForm; form: HomeForm }> {
  const id = parseId(rawId);

  const [row] = await db
    .select({ caseForm: caseFormsTable, form: homeFormsTable })
    .from(caseFormsTable)
    .innerJoin(homeFormsTable, eq(homeFormsTable.id, caseFormsTable.formId))
    .where(
      and(
        eq(caseFormsTable.id, id),
        eq(caseFormsTable.caseId, caseId),
        eq(caseFormsTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  return requireRow(row, "That form could not be found.");
}

function fieldsFor(formId: number) {
  return db
    .select()
    .from(homeFormFieldsTable)
    .where(eq(homeFormFieldsTable.formId, formId))
    .orderBy(asc(homeFormFieldsTable.position), asc(homeFormFieldsTable.id));
}

async function answersFor(
  caseId: number,
  formId: number,
): Promise<Map<string, CaseFormAnswer>> {
  const rows = await db
    .select()
    .from(caseFormAnswersTable)
    .where(
      and(
        eq(caseFormAnswersTable.caseId, caseId),
        eq(caseFormAnswersTable.formId, formId),
      ),
    );

  return new Map(rows.map((row) => [row.fieldKey, row]));
}

async function flagsFor(caseId: number, formId: number): Promise<Map<string, string>> {
  const rows = await db
    .select()
    .from(caseFormFlagsTable)
    .where(
      and(
        eq(caseFormFlagsTable.caseId, caseId),
        eq(caseFormFlagsTable.formId, formId),
      ),
    );

  return new Map(
    rows.filter((row) => row.clearedAt === null).map((row) => [row.fieldKey, row.note]),
  );
}

/* ------------------------------------------------------------ sensitive -- */

/**
 * A box the home marked sensitive, read back the way `vital-statistics.ts`
 * reads back a social security number: masked for staff, withheld from the
 * family portal entirely.
 *
 * The family cannot re-read what they typed. That is the right trade and the
 * same one the death certificate makes — the cost is retyping a policy number
 * if they got it wrong, and what it buys is that a forwarded link open on a
 * kitchen table does not display it.
 */
function maskTail(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  return trimmed.length <= 4 ? "••••" : `••••${trimmed.slice(-4)}`;
}

function readStored(field: HomeFormField, stored: string): string {
  if (!field.sensitive || stored === "") return stored;

  try {
    return decrypt(stored);
  } catch (err) {
    // A rotated key must not take down a whole form. The box reads as empty,
    // which is honest: we can no longer tell anybody what is in it.
    logger.error({ err }, "Could not decrypt a form answer");
    return "";
  }
}

/* -------------------------------------------------------------- prefill -- */

/**
 * What the case already knows, keyed by the sources a box can name.
 *
 * This is "never ask twice" made concrete. A form that asks a daughter for her
 * mother's date of birth on a case that already holds it is a defect, not a
 * small one — so a box with a `prefillFrom` arrives already filled, and
 * editable, and the family's job is to correct rather than to type.
 *
 * Suggestions are never written to the answers table on their own. A box that
 * nobody has looked at must keep reading as unanswered, or "what is left to
 * do" quietly becomes a lie.
 */
async function prefillFor(input: {
  case: Case;
  home: FuneralHome;
  contact: FamilyContact | null;
}): Promise<Map<string, string>> {
  const row = input.case;

  const [vitals] = await db
    .select()
    .from(vitalStatisticsTable)
    .where(eq(vitalStatisticsTable.caseId, row.id))
    .limit(1);

  const day = (value: Date | null) =>
    value ? value.toISOString().slice(0, 10) : "";

  const values: Record<(typeof FORM_PREFILL_SOURCES)[number], string> = {
    "decedent.firstName": row.decedentFirstName,
    "decedent.lastName": row.decedentLastName,
    "decedent.fullName": decedentDisplayName(row),
    "decedent.dateOfBirth": day(row.dateOfBirth),
    "decedent.dateOfDeath": day(row.dateOfDeath),
    "vitals.legalFirstName": vitals?.legalFirstName ?? "",
    "vitals.legalMiddleName": vitals?.legalMiddleName ?? "",
    "vitals.legalLastName": vitals?.legalLastName ?? "",
    "vitals.nameAtBirth": vitals?.nameAtBirth ?? "",
    "vitals.dateOfBirth": vitals?.dateOfBirth ?? "",
    "vitals.birthCity": vitals?.birthCity ?? "",
    "vitals.birthState": vitals?.birthState ?? "",
    "vitals.motherMaidenName": vitals?.motherMaidenName ?? "",
    "vitals.fatherLastName": vitals?.fatherLastName ?? "",
    "vitals.residenceLine1": vitals?.residenceLine1 ?? "",
    "vitals.residenceCity": vitals?.residenceCity ?? "",
    "vitals.residenceState": vitals?.residenceState ?? "",
    "vitals.residencePostalCode": vitals?.residencePostalCode ?? "",
    "vitals.informantName": vitals?.informantName ?? "",
    "vitals.informantRelationship": vitals?.informantRelationship ?? "",
    "vitals.informantPhone": vitals?.informantPhone ?? "",
    "home.name": input.home.name,
    "case.serviceAt": row.serviceAt ? row.serviceAt.toISOString().slice(0, 16) : "",
    "contact.name": input.contact?.name ?? "",
    "contact.relationship": input.contact?.relationship ?? "",
  };

  return new Map(
    Object.entries(values).filter(([, value]) => value.trim() !== ""),
  );
}

/* ----------------------------------------------------------------- JSON -- */

function toHomeFormJson(form: HomeForm, fieldCount: number) {
  return {
    id: form.id,
    name: form.name,
    note: form.note,
    kind: form.kind,
    requiredLevel: form.requiredLevel,
    blocksCertificate: form.blocksCertificate,
    attachByDefault: form.attachByDefault,
    inPreNeed: form.inPreNeed,
    sourceUploadId: form.sourceUploadId,
    position: form.position,
    fieldCount,
    retiredAt: form.retiredAt,
  };
}

function toHomeFormFieldJson(field: HomeFormField) {
  return {
    id: field.id,
    key: field.key,
    label: field.label,
    kind: field.kind,
    options: fieldOptions(field),
    help: field.help,
    required: field.required,
    onlyFamilyKnows: field.onlyFamilyKnows,
    prefillFrom: field.prefillFrom,
    sensitive: field.sensitive,
    position: field.position,
  };
}

type FormProgress = {
  requiredCount: number;
  answeredCount: number;
  blockingCount: number;
  complete: boolean;
};

/**
 * Counting asks "is this box blank", never "what does it say", so it reads
 * the stored column without decrypting anything. Turning the key on forty
 * boxes to answer a question that does not need the plaintext would be a lot
 * of work for nothing, and would put a social security number in memory on
 * every page load of a list.
 */
function progressOf(
  fields: HomeFormField[],
  answers: Map<string, CaseFormAnswer>,
): FormProgress {
  const filled = new Map([...answers].map(([key, row]) => [key, row.value]));
  const required = fields.filter((f) => f.required);

  return {
    requiredCount: required.length,
    answeredCount: required.filter((f) => (filled.get(f.key) ?? "").trim() !== "")
      .length,
    blockingCount: blockingFields(fields, filled).length,
    complete: formIsComplete(fields, filled),
  };
}

function toCaseFormJson(input: {
  caseForm: CaseForm;
  form: HomeForm;
  progress: FormProgress;
  authorizationCount: number;
}) {
  const { caseForm, form, progress } = input;

  return {
    id: caseForm.id,
    formId: form.id,
    name: form.name,
    note: form.note,
    kind: form.kind,
    requiredLevel: form.requiredLevel,
    blocksCertificate: form.blocksCertificate,
    sharedWithFamily: caseForm.sharedWithFamily,
    sourceUploadId: form.sourceUploadId,
    requiredCount: progress.requiredCount,
    answeredCount: progress.answeredCount,
    blockingCount: progress.blockingCount,
    complete: progress.complete,
    completedAt: caseForm.completedAt,
    authorizationCount: input.authorizationCount,
  };
}

function toCaseFormFieldJson(input: {
  field: HomeFormField;
  answer: CaseFormAnswer | undefined;
  suggested: string | undefined;
  note: string | undefined;
  forStaff: boolean;
}) {
  const { field, answer, forStaff } = input;
  const stored = answer?.value ?? "";
  const plain = readStored(field, stored);
  const hasValue = stored.trim() !== "";

  return {
    key: field.key,
    label: field.label,
    kind: field.kind,
    options: fieldOptions(field),
    help: field.help,
    required: field.required,
    onlyFamilyKnows: field.onlyFamilyKnows,
    sensitive: field.sensitive,
    prefillFrom: field.prefillFrom,
    value: field.sensitive ? null : plain,
    masked: field.sensitive && forStaff && hasValue ? maskTail(plain) : null,
    hasValue,
    suggested: hasValue ? null : (input.suggested ?? null),
    source: answer?.source ?? null,
    answeredAt: answer?.answeredAt ?? null,
    note: input.note ?? null,
  };
}

/* ------------------------------------------------------- authorizations -- */

async function authorizationsFor(input: {
  caseId: number;
  caseFormId?: number;
  authorizationId?: number;
}): Promise<ReturnType<typeof toAuthorizationJson>[]> {
  const rows = await db
    .select({
      authorization: caseAuthorizationsTable,
      formName: homeFormsTable.name,
      formId: homeFormsTable.id,
    })
    .from(caseAuthorizationsTable)
    .innerJoin(
      caseFormsTable,
      eq(caseFormsTable.id, caseAuthorizationsTable.caseFormId),
    )
    .innerJoin(homeFormsTable, eq(homeFormsTable.id, caseFormsTable.formId))
    .where(
      and(
        eq(caseAuthorizationsTable.caseId, input.caseId),
        input.caseFormId === undefined
          ? undefined
          : eq(caseAuthorizationsTable.caseFormId, input.caseFormId),
        input.authorizationId === undefined
          ? undefined
          : eq(caseAuthorizationsTable.id, input.authorizationId),
      ),
    )
    .orderBy(asc(caseAuthorizationsTable.signedAt), asc(caseAuthorizationsTable.id));

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.authorization.id);

  const consents = await db
    .select({
      consent: caseAuthorizationConsentsTable,
      recordedByName: usersTable.displayName,
    })
    .from(caseAuthorizationConsentsTable)
    .leftJoin(
      usersTable,
      eq(usersTable.id, caseAuthorizationConsentsTable.recordedByUserId),
    )
    .where(inArray(caseAuthorizationConsentsTable.authorizationId, ids))
    .orderBy(asc(caseAuthorizationConsentsTable.consentedAt));

  const staff = await staffNames([
    ...rows.map((row) => row.authorization.verifiedByUserId),
    ...rows.map((row) => row.authorization.recordedByUserId),
  ]);

  return rows.map((row) =>
    toAuthorizationJson({
      authorization: row.authorization,
      formId: row.formId,
      formName: row.formName,
      consents: consents
        .filter((c) => c.consent.authorizationId === row.authorization.id)
        .map((c) => ({
          id: c.consent.id,
          personName: c.consent.personName,
          relationship: c.consent.relationship,
          channel: c.consent.channel,
          consentedAt: c.consent.consentedAt,
          recordedByName: c.recordedByName,
        })),
      verifiedByName: staff.get(row.authorization.verifiedByUserId ?? -1) ?? null,
      recordedByName: staff.get(row.authorization.recordedByUserId ?? -1) ?? null,
    }),
  );
}

async function staffNames(
  ids: (number | null)[],
): Promise<Map<number, string | null>> {
  const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
  if (wanted.length === 0) return new Map();

  const rows = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(inArray(usersTable.id, wanted));

  return new Map(rows.map((row) => [row.id, row.displayName]));
}

function toAuthorizationJson(input: {
  authorization: CaseAuthorization;
  formId: number;
  formName: string;
  consents: {
    id: number;
    personName: string;
    relationship: string | null;
    channel: string;
    consentedAt: Date;
    recordedByName: string | null;
  }[];
  verifiedByName: string | null;
  recordedByName: string | null;
}) {
  const row = input.authorization;

  return {
    id: row.id,
    caseFormId: row.caseFormId,
    formId: input.formId,
    formName: input.formName,
    claimedTier: row.claimedTier,
    requiresMajority: row.requiresMajority,
    tierMemberCount: row.tierMemberCount,
    consentCount: input.consents.length,
    majorityRecorded: row.requiresMajority
      ? majorityRecorded(input.consents.length, row.tierMemberCount)
      : null,
    signedName: row.signedName,
    signedRelationship: row.signedRelationship,
    signedAt: row.signedAt,
    signedByContactId: row.signedByContactId,
    recordedByName: input.recordedByName,
    verifiedByName: input.verifiedByName,
    verifiedAt: row.verifiedAt,
    verificationNote: row.verificationNote,
    consents: input.consents,
  };
}

/* ---------------------------------------------------------- the answers -- */

/**
 * Write what somebody typed, and clear the notes their answers resolve.
 *
 * Two rules, both of them load-bearing on the family surface:
 *
 * A save is never refused for being incomplete. Somebody filling this in on a
 * phone at midnight, three boxes done, must be able to put the phone down.
 *
 * A key with no box behind it is skipped rather than rejected. The home may
 * have removed that box while the family had the page open, and answering
 * with a 400 would lose the four boxes that *do* still exist along with it.
 */
async function storeAnswers(input: {
  funeralHomeId: number;
  caseId: number;
  form: HomeForm;
  caseForm: CaseForm;
  fields: HomeFormField[];
  answers: { fieldKey: string; value: string }[];
  source: "family" | "self" | "staff";
}): Promise<void> {
  const byKey = new Map(input.fields.map((field) => [field.key, field]));
  const now = new Date();

  for (const answer of input.answers) {
    const field = byKey.get(answer.fieldKey);
    if (!field) continue;

    const trimmed = answer.value.trim();
    const value =
      field.sensitive && trimmed !== "" ? encrypt(trimmed) : trimmed;

    await db
      .insert(caseFormAnswersTable)
      .values({
        funeralHomeId: input.funeralHomeId,
        caseId: input.caseId,
        formId: input.form.id,
        fieldKey: field.key,
        value,
        source: input.source,
        answeredAt: now,
      })
      .onConflictDoUpdate({
        target: [
          caseFormAnswersTable.caseId,
          caseFormAnswersTable.formId,
          caseFormAnswersTable.fieldKey,
        ],
        set: { value, source: input.source, answeredAt: now, updatedAt: now },
      });

    // A note against a box is cleared by the box being answered, never by
    // anybody marking it resolved. The director is not the one who knows.
    if (trimmed !== "") {
      await db
        .update(caseFormFlagsTable)
        .set({ clearedAt: now, updatedAt: now })
        .where(
          and(
            eq(caseFormFlagsTable.caseId, input.caseId),
            eq(caseFormFlagsTable.formId, input.form.id),
            eq(caseFormFlagsTable.fieldKey, field.key),
          ),
        );
    }
  }

  const stored = await answersFor(input.caseId, input.form.id);
  const complete = progressOf(input.fields, stored).complete;

  await db
    .update(caseFormsTable)
    .set({
      completedAt: complete ? (input.caseForm.completedAt ?? now) : null,
      updatedAt: now,
    })
    .where(eq(caseFormsTable.id, input.caseForm.id));
}

/**
 * An authorization that has been signed stops taking answers.
 *
 * The signature snapshots the boxes as they stood at that moment, and that
 * snapshot is the document. Letting the live answers drift afterwards would
 * leave two versions of what was signed and no way to tell which one anybody
 * saw. A change after the fact is a new authorization, which is what
 * append-only means in practice.
 */
async function assertNotAlreadySigned(
  caseId: number,
  caseFormId: number,
): Promise<void> {
  const [signed] = await db
    .select({ id: caseAuthorizationsTable.id })
    .from(caseAuthorizationsTable)
    .where(
      and(
        eq(caseAuthorizationsTable.caseId, caseId),
        eq(caseAuthorizationsTable.caseFormId, caseFormId),
      ),
    )
    .limit(1);

  if (signed) {
    throw new HttpError(
      409,
      "This one has been signed, so it stays as it was signed. Tell the " +
        "funeral home what needs changing and they will record a new one.",
    );
  }
}

async function caseFormDetail(input: {
  case: Case;
  home: FuneralHome;
  contact: FamilyContact | null;
  caseForm: CaseForm;
  form: HomeForm;
  forStaff: boolean;
}) {
  const [fields, answers, flags, authorizations, prefill] = await Promise.all([
    fieldsFor(input.form.id),
    answersFor(input.case.id, input.form.id),
    flagsFor(input.case.id, input.form.id),
    authorizationsFor({ caseId: input.case.id, caseFormId: input.caseForm.id }),
    prefillFor({ case: input.case, home: input.home, contact: input.contact }),
  ]);

  const [current] = await db
    .select()
    .from(caseFormsTable)
    .where(eq(caseFormsTable.id, input.caseForm.id))
    .limit(1);

  return {
    ...toCaseFormJson({
      caseForm: current ?? input.caseForm,
      form: input.form,
      progress: progressOf(fields, answers),
      authorizationCount: authorizations.length,
    }),
    fields: fields.map((field) =>
      toCaseFormFieldJson({
        field,
        answer: answers.get(field.key),
        suggested: field.prefillFrom
          ? prefill.get(field.prefillFrom)
          : undefined,
        note: flags.get(field.key),
        forStaff: input.forStaff,
      }),
    ),
    authorizations,
  };
}

/* ======================================================= staff: library == */

router.get("/forms", async (req, res) => {
  const home = tenant(req);
  const query = parseQuery(GetHomeFormsQueryParams, req.query);

  const rows = await db
    .select()
    .from(homeFormsTable)
    .where(eq(homeFormsTable.funeralHomeId, home.id))
    .orderBy(asc(homeFormsTable.position), asc(homeFormsTable.id));

  const visible = query.includeRetired
    ? rows
    : rows.filter((row) => row.retiredAt === null);

  const counts = await fieldCounts(visible.map((row) => row.id));

  res.json(visible.map((row) => toHomeFormJson(row, counts.get(row.id) ?? 0)));
});

async function fieldCounts(formIds: number[]): Promise<Map<number, number>> {
  if (formIds.length === 0) return new Map();

  const rows = await db
    .select({ formId: homeFormFieldsTable.formId, id: homeFormFieldsTable.id })
    .from(homeFormFieldsTable)
    .where(inArray(homeFormFieldsTable.formId, formIds));

  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.formId, (counts.get(row.formId) ?? 0) + 1);
  }
  return counts;
}

/**
 * An authorization is always completed at the `authorizing` level.
 *
 * Forced rather than validated, and the difference matters: a home that
 * picked the wrong level in a dropdown gets a form that behaves correctly
 * rather than an error message about a statute. A cremation authorization a
 * cousin could sign is not an authorization.
 */
function levelFor(kind: string, requested: string | undefined): FamilyAccessLevel {
  if (kind === "authorization") return "authorizing";
  return (requested as FamilyAccessLevel | undefined) ?? "arranging";
}

router.post("/forms", async (req, res) => {
  const home = tenant(req);
  const body = parseBody(CreateHomeFormBody, req.body);

  const name = body.name.trim();
  if (name === "") throw badRequest("A form needs a name.");

  const [last] = await db
    .select({ value: max(homeFormsTable.position) })
    .from(homeFormsTable)
    .where(eq(homeFormsTable.funeralHomeId, home.id));

  const kind = body.kind ?? "form";

  const [created] = await db
    .insert(homeFormsTable)
    .values({
      funeralHomeId: home.id,
      name,
      note: body.note?.trim() || null,
      kind,
      requiredLevel: levelFor(kind, body.requiredLevel),
      blocksCertificate: body.blocksCertificate ?? false,
      attachByDefault: body.attachByDefault ?? true,
      inPreNeed: body.inPreNeed ?? false,
      sourceUploadId: body.sourceUploadId ?? null,
      position: (last?.value ?? -1) + 1,
    })
    .returning();

  res.status(201).json(toHomeFormJson(created!, 0));
});

router.get("/forms/:formId", async (req, res) => {
  const form = await loadHomeForm(req, req.params.formId);
  const fields = await fieldsFor(form.id);

  res.json({
    ...toHomeFormJson(form, fields.length),
    fields: fields.map(toHomeFormFieldJson),
  });
});

router.patch("/forms/:formId", async (req, res) => {
  const form = await loadHomeForm(req, req.params.formId);
  const body = assertHasUpdates(parseBody(UpdateHomeFormBody, req.body));

  const [updated] = await db
    .update(homeFormsTable)
    .set({
      ...(body.name === undefined ? {} : { name: body.name.trim() }),
      ...(body.note === undefined ? {} : { note: body.note?.trim() || null }),
      ...(body.requiredLevel === undefined
        ? {}
        : { requiredLevel: levelFor(form.kind, body.requiredLevel) }),
      ...(body.blocksCertificate === undefined
        ? {}
        : { blocksCertificate: body.blocksCertificate }),
      ...(body.attachByDefault === undefined
        ? {}
        : { attachByDefault: body.attachByDefault }),
      ...(body.inPreNeed === undefined ? {} : { inPreNeed: body.inPreNeed }),
      ...(body.sourceUploadId === undefined
        ? {}
        : { sourceUploadId: body.sourceUploadId }),
      ...(body.position === undefined ? {} : { position: body.position }),
      ...(body.retired === undefined
        ? {}
        : { retiredAt: body.retired ? (form.retiredAt ?? new Date()) : null }),
      updatedAt: new Date(),
    })
    .where(eq(homeFormsTable.id, form.id))
    .returning();

  const fields = await fieldsFor(form.id);
  res.json(toHomeFormJson(updated!, fields.length));
});

router.put("/forms/:formId/fields", async (req, res) => {
  const home = tenant(req);
  const form = await loadHomeForm(req, req.params.formId);
  const body = parseBody(SetHomeFormFieldsBody, req.body);

  const seen = new Set<string>();
  for (const field of body.fields) {
    const key = field.key.trim();
    if (seen.has(key)) {
      throw badRequest(`Two boxes on this form are both called "${key}".`);
    }
    seen.add(key);

    if (
      field.prefillFrom &&
      !(FORM_PREFILL_SOURCES as readonly string[]).includes(field.prefillFrom)
    ) {
      throw badRequest(
        `There is nothing on a case called "${field.prefillFrom}" to fill that box from.`,
      );
    }
  }

  // Replaced wholesale, which is how the builder edits it. Answers live
  // against the key rather than the row, so a key that survives this keeps
  // what a family already typed, and a key that does not leaves its answers
  // where they are — nothing in this product deletes what a family wrote.
  await db
    .delete(homeFormFieldsTable)
    .where(eq(homeFormFieldsTable.formId, form.id));

  if (body.fields.length > 0) {
    await db.insert(homeFormFieldsTable).values(
      body.fields.map((field, index) => ({
        funeralHomeId: home.id,
        formId: form.id,
        key: field.key.trim(),
        label: field.label.trim(),
        kind: field.kind ?? "text",
        options: field.options?.length ? field.options.join("\n") : null,
        help: field.help?.trim() || null,
        required: field.required ?? false,
        onlyFamilyKnows: field.onlyFamilyKnows ?? false,
        prefillFrom: field.prefillFrom ?? null,
        sensitive: field.sensitive ?? false,
        position: index,
      })),
    );
  }

  const fields = await fieldsFor(form.id);

  res.json({
    ...toHomeFormJson(form, fields.length),
    fields: fields.map(toHomeFormFieldJson),
  });
});

/* ==================================================== staff: on one case == */

/**
 * The forms on a case, with what is left to do on each.
 *
 * Ordered with anything feeding the death certificate first. That ordering is
 * the 72-hour clock showing through the furniture: what the certificate needs
 * is asked for before what it does not, on every surface, without anybody
 * having to be told.
 */
async function caseFormsFor(input: {
  case: Case;
  onlyShared: boolean;
  visibleTo: FamilyContact | null;
}) {
  const rows = await db
    .select({ caseForm: caseFormsTable, form: homeFormsTable })
    .from(caseFormsTable)
    .innerJoin(homeFormsTable, eq(homeFormsTable.id, caseFormsTable.formId))
    .where(eq(caseFormsTable.caseId, input.case.id))
    .orderBy(asc(homeFormsTable.position), asc(caseFormsTable.id));

  const visible = rows.filter((row) => {
    if (input.onlyShared && !row.caseForm.sharedWithFamily) return false;
    // A `viewing` cousin has no business reading the home's authorization
    // documents, so the list itself is filtered rather than the buttons on it.
    if (
      input.visibleTo &&
      !atLeast(input.visibleTo, row.form.requiredLevel as FamilyAccessLevel)
    ) {
      return false;
    }
    return true;
  });

  const ordered = [...visible].sort((a, b) => {
    if (a.form.blocksCertificate !== b.form.blocksCertificate) {
      return a.form.blocksCertificate ? -1 : 1;
    }
    return a.form.position - b.form.position || a.caseForm.id - b.caseForm.id;
  });

  const authorizations = await authorizationsFor({ caseId: input.case.id });

  return Promise.all(
    ordered.map(async (row) => {
      const [fields, answers] = await Promise.all([
        fieldsFor(row.form.id),
        answersFor(input.case.id, row.form.id),
      ]);

      return toCaseFormJson({
        caseForm: row.caseForm,
        form: row.form,
        progress: progressOf(fields, answers),
        authorizationCount: authorizations.filter(
          (a) => a.caseFormId === row.caseForm.id,
        ).length,
      });
    }),
  );
}

router.get("/cases/:caseId/forms", async (req, res) => {
  const row = await loadCase(req, req.params.caseId);
  res.json(await caseFormsFor({ case: row, onlyShared: false, visibleTo: null }));
});

router.post("/cases/:caseId/forms", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const body = parseBody(AssignCaseFormBody, req.body);

  const [form] = await db
    .select()
    .from(homeFormsTable)
    .where(
      and(
        eq(homeFormsTable.id, body.formId),
        eq(homeFormsTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  requireRow(form, "That form could not be found.");

  const [existing] = await db
    .select()
    .from(caseFormsTable)
    .where(
      and(eq(caseFormsTable.caseId, row.id), eq(caseFormsTable.formId, form!.id)),
    )
    .limit(1);

  if (existing) {
    const [fields, answers] = await Promise.all([
      fieldsFor(form!.id),
      answersFor(row.id, form!.id),
    ]);

    res.status(200).json(
      toCaseFormJson({
        caseForm: existing,
        form: form!,
        progress: progressOf(fields, answers),
        authorizationCount: (
          await authorizationsFor({ caseId: row.id, caseFormId: existing.id })
        ).length,
      }),
    );
    return;
  }

  const [created] = await db
    .insert(caseFormsTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      formId: form!.id,
      sharedWithFamily: body.sharedWithFamily ?? true,
      assignedByUserId: user.id,
    })
    .returning();

  const fields = await fieldsFor(form!.id);

  res.status(201).json(
    toCaseFormJson({
      caseForm: created!,
      form: form!,
      progress: progressOf(fields, new Map()),
      authorizationCount: 0,
    }),
  );
});

router.get("/cases/:caseId/forms/:caseFormId", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const { caseForm, form } = await loadCaseForm(
    home.id,
    row.id,
    req.params.caseFormId,
  );

  res.json(
    await caseFormDetail({
      case: row,
      home,
      contact: null,
      caseForm,
      form,
      forStaff: true,
    }),
  );
});

router.patch("/cases/:caseId/forms/:caseFormId", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const { caseForm, form } = await loadCaseForm(
    home.id,
    row.id,
    req.params.caseFormId,
  );
  const body = parseBody(UpdateCaseFormBody, req.body);

  const [updated] = await db
    .update(caseFormsTable)
    .set({ sharedWithFamily: body.sharedWithFamily, updatedAt: new Date() })
    .where(eq(caseFormsTable.id, caseForm.id))
    .returning();

  const [fields, answers] = await Promise.all([
    fieldsFor(form.id),
    answersFor(row.id, form.id),
  ]);

  res.json(
    toCaseFormJson({
      caseForm: updated!,
      form,
      progress: progressOf(fields, answers),
      authorizationCount: (
        await authorizationsFor({ caseId: row.id, caseFormId: caseForm.id })
      ).length,
    }),
  );
});

router.put("/cases/:caseId/forms/:caseFormId/answers", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const { caseForm, form } = await loadCaseForm(
    home.id,
    row.id,
    req.params.caseFormId,
  );
  const body = parseBody(SetCaseFormAnswersBody, req.body);

  await assertNotAlreadySigned(row.id, caseForm.id);

  const fields = await fieldsFor(form.id);

  await storeAnswers({
    funeralHomeId: home.id,
    caseId: row.id,
    form,
    caseForm,
    fields,
    answers: body.answers,
    source: "staff",
  });

  res.json(
    await caseFormDetail({
      case: row,
      home,
      contact: null,
      caseForm,
      form,
      forStaff: true,
    }),
  );
});

router.post("/cases/:caseId/forms/:caseFormId/flags", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const { caseForm, form } = await loadCaseForm(
    home.id,
    row.id,
    req.params.caseFormId,
  );
  const body = parseBody(FlagCaseFormFieldBody, req.body);

  const fields = await fieldsFor(form.id);
  const field = fields.find((f) => f.key === body.fieldKey);

  if (!field) throw badRequest("There is no box on that form with that name.");

  const now = new Date();

  await db
    .insert(caseFormFlagsTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      formId: form.id,
      fieldKey: field.key,
      note: body.note.trim(),
      raisedByUserId: user.id,
    })
    .onConflictDoUpdate({
      target: [
        caseFormFlagsTable.caseId,
        caseFormFlagsTable.formId,
        caseFormFlagsTable.fieldKey,
      ],
      set: {
        note: body.note.trim(),
        raisedByUserId: user.id,
        clearedAt: null,
        updatedAt: now,
      },
    });

  res.json(
    await caseFormDetail({
      case: row,
      home,
      contact: null,
      caseForm,
      form,
      forStaff: true,
    }),
  );
});

router.get("/cases/:caseId/forms/:caseFormId/render", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const { caseForm, form } = await loadCaseForm(
    home.id,
    row.id,
    req.params.caseFormId,
  );

  sendPrintable(
    res,
    await renderCaseForm({ case: row, home, contact: null, caseForm, form }),
  );
});

/* ========================================= staff: authorizations on a case */

router.get("/cases/:caseId/authorizations", async (req, res) => {
  const row = await loadCase(req, req.params.caseId);
  res.json(await authorizationsFor({ caseId: row.id }));
});

router.post("/cases/:caseId/authorizations", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const body = parseBody(RecordCaseAuthorizationBody, req.body);

  const { caseForm, form } = await loadCaseForm(
    home.id,
    row.id,
    String(body.caseFormId),
  );

  if (form.kind !== "authorization") {
    throw badRequest(
      `"${form.name}" is not an authorization. Change the form's type first, ` +
        "or record this against the document that authorizes it.",
    );
  }

  const tier = body.claimedTier.trim();
  const requiresMajority = tierRequiresMajority(tier);
  const answers = await answersFor(row.id, form.id);

  const [created] = await db
    .insert(caseAuthorizationsTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      caseFormId: caseForm.id,
      claimedTier: tier,
      requiresMajority,
      tierMemberCount: body.tierMemberCount ?? null,
      signedName: body.signedName.trim(),
      signedRelationship: body.signedRelationship?.trim() || null,
      signedAt: body.signedAt ?? new Date(),
      recordedByUserId: user.id,
      answersSnapshot: snapshotOf(answers),
    })
    .returning();

  const consents = body.consents ?? [];

  if (consents.length > 0) {
    await db.insert(caseAuthorizationConsentsTable).values(
      consents.map((consent) => ({
        funeralHomeId: home.id,
        caseId: row.id,
        authorizationId: created!.id,
        personName: consent.personName.trim(),
        relationship: consent.relationship?.trim() || null,
        channel: consent.channel ?? "in_person",
        consentedAt: consent.consentedAt ?? new Date(),
        recordedByUserId: user.id,
      })),
    );
  }

  const [json] = await authorizationsFor({
    caseId: row.id,
    authorizationId: created!.id,
  });

  res.status(201).json(json);
});

/** The answers as they stood when it was signed. Never read back out again. */
function snapshotOf(answers: Map<string, CaseFormAnswer>): string {
  const plain: Record<string, string> = {};
  for (const [key, row] of answers) plain[key] = row.value;
  return JSON.stringify(plain);
}

async function loadAuthorization(
  funeralHomeId: number,
  caseId: number,
  rawId: string | undefined,
): Promise<CaseAuthorization> {
  const id = parseId(rawId);

  const [row] = await db
    .select()
    .from(caseAuthorizationsTable)
    .where(
      and(
        eq(caseAuthorizationsTable.id, id),
        eq(caseAuthorizationsTable.caseId, caseId),
        eq(caseAuthorizationsTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  return requireRow(row, "That authorization could not be found.");
}

router.post(
  "/cases/:caseId/authorizations/:authorizationId/verify",
  async (req, res) => {
    const home = tenant(req);
    const user = currentUser(req);
    const row = await loadCase(req, req.params.caseId);
    const authorization = await loadAuthorization(
      home.id,
      row.id,
      req.params.authorizationId,
    );
    const body = parseBody(VerifyCaseAuthorizationBody, req.body);

    // Once. The point of the row is that it is what was recorded at the time,
    // so a second look reaching a different conclusion is a new authorization
    // rather than a rewrite of this one.
    if (authorization.verifiedAt !== null) {
      throw new HttpError(
        409,
        "This authorization has already been verified. Record a new one if " +
          "what you have seen since changes it.",
      );
    }

    await db
      .update(caseAuthorizationsTable)
      .set({
        verifiedByUserId: user.id,
        verifiedAt: new Date(),
        verificationNote: body.verificationNote.trim(),
      })
      .where(eq(caseAuthorizationsTable.id, authorization.id));

    const [json] = await authorizationsFor({
      caseId: row.id,
      authorizationId: authorization.id,
    });

    res.json(json);
  },
);

router.post(
  "/cases/:caseId/authorizations/:authorizationId/consents",
  async (req, res) => {
    const home = tenant(req);
    const user = currentUser(req);
    const row = await loadCase(req, req.params.caseId);
    const authorization = await loadAuthorization(
      home.id,
      row.id,
      req.params.authorizationId,
    );
    const body = parseBody(AddAuthorizationConsentBody, req.body);

    await db.insert(caseAuthorizationConsentsTable).values({
      funeralHomeId: home.id,
      caseId: row.id,
      authorizationId: authorization.id,
      personName: body.personName.trim(),
      relationship: body.relationship?.trim() || null,
      channel: body.channel ?? "in_person",
      consentedAt: body.consentedAt ?? new Date(),
      recordedByUserId: user.id,
    });

    const [json] = await authorizationsFor({
      caseId: row.id,
      authorizationId: authorization.id,
    });

    res.status(201).json(json);
  },
);

/* ============================================ staff: the 72-hour clock == */

/**
 * The sentence every screen showing this record has to carry.
 *
 * Returned by the API rather than written into each client, because there are
 * two frontends and a print sheet and the one thing that must never differ
 * between them is this. A director who believes this product filed a death
 * certificate for them finds out otherwise from the registrar.
 */
const FILING_NOTICE =
  "We do not file this. The funeral home files it through Colorado's EDRS " +
  "within 72 hours of taking custody. What this does is get you there with " +
  "every field already answered.";

/** Created on first read, so no caller has to handle a missing record. */
async function certificateFor(
  caseId: number,
  funeralHomeId: number,
): Promise<DeathCertificateFiling> {
  const [existing] = await db
    .select()
    .from(deathCertificateFilingsTable)
    .where(
      and(
        eq(deathCertificateFilingsTable.caseId, caseId),
        eq(deathCertificateFilingsTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(deathCertificateFilingsTable)
    .values({ funeralHomeId, caseId })
    .onConflictDoNothing({ target: deathCertificateFilingsTable.caseId })
    .returning();

  if (created) return created;

  // Lost a race with another tab opening the same case.
  const [raced] = await db
    .select()
    .from(deathCertificateFilingsTable)
    .where(eq(deathCertificateFilingsTable.caseId, caseId))
    .limit(1);

  return raced!;
}

async function certificateJson(row: DeathCertificateFiling, subject: Case) {
  const dueAt = certificateDueAt(row);
  const staff = await staffNames([row.filedByUserId]);

  const forms = await db
    .select({ caseForm: caseFormsTable, form: homeFormsTable })
    .from(caseFormsTable)
    .innerJoin(homeFormsTable, eq(homeFormsTable.id, caseFormsTable.formId))
    .where(
      and(
        eq(caseFormsTable.caseId, subject.id),
        eq(homeFormsTable.blocksCertificate, true),
      ),
    )
    .orderBy(asc(homeFormsTable.position));

  const outstanding = [];

  for (const row2 of forms) {
    const [fields, answers] = await Promise.all([
      fieldsFor(row2.form.id),
      answersFor(subject.id, row2.form.id),
    ]);

    const blocking = blockingFields(
      fields,
      new Map([...answers].map(([key, a]) => [key, a.value])),
    );

    if (blocking.length > 0) {
      outstanding.push({
        caseFormId: row2.caseForm.id,
        formName: row2.form.name,
        fields: blocking.map((field) => ({ key: field.key, label: field.label })),
      });
    }
  }

  return {
    custodyTakenAt: row.custodyTakenAt,
    dueAt,
    hoursRemaining:
      dueAt === null
        ? null
        : Math.round(((dueAt.getTime() - Date.now()) / 3_600_000) * 10) / 10,
    edrsRequestedAt: row.edrsRequestedAt,
    certificationDueAt: certificationDueAt(row),
    certifyingProvider: row.certifyingProvider,
    filedAt: row.filedAt,
    filedByName: staff.get(row.filedByUserId ?? -1) ?? null,
    stateFileNumber: row.stateFileNumber,
    notes: row.notes,
    filingNotice: FILING_NOTICE,
    outstanding,
  };
}

router.get("/cases/:caseId/certificate", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  res.json(await certificateJson(await certificateFor(row.id, home.id), row));
});

router.put("/cases/:caseId/certificate", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const existing = await certificateFor(row.id, home.id);
  const body = assertHasUpdates(parseBody(UpdateDeathCertificateRecordBody, req.body));

  const [updated] = await db
    .update(deathCertificateFilingsTable)
    .set({
      ...(body.custodyTakenAt === undefined
        ? {}
        : { custodyTakenAt: body.custodyTakenAt }),
      ...(body.edrsRequestedAt === undefined
        ? {}
        : { edrsRequestedAt: body.edrsRequestedAt }),
      ...(body.certifyingProvider === undefined
        ? {}
        : { certifyingProvider: body.certifyingProvider?.trim() || null }),
      ...(body.stateFileNumber === undefined
        ? {}
        : { stateFileNumber: body.stateFileNumber?.trim() || null }),
      ...(body.notes === undefined ? {} : { notes: body.notes?.trim() || null }),
      ...(body.filed === undefined
        ? {}
        : body.filed
          ? {
              filedAt: existing.filedAt ?? new Date(),
              filedByUserId: existing.filedByUserId ?? user.id,
            }
          : { filedAt: null, filedByUserId: null }),
      updatedAt: new Date(),
    })
    .where(eq(deathCertificateFilingsTable.id, existing.id))
    .returning();

  res.json(await certificateJson(updated!, row));
});

/* ================================================== staff: the policies == */

async function policyJson(policyId: number) {
  const [policy] = await db
    .select()
    .from(homePoliciesTable)
    .where(eq(homePoliciesTable.id, policyId))
    .limit(1);

  const versions = await db
    .select({ version: homePolicyVersionsTable, publishedByName: usersTable.displayName })
    .from(homePolicyVersionsTable)
    .leftJoin(
      usersTable,
      eq(usersTable.id, homePolicyVersionsTable.publishedByUserId),
    )
    .where(eq(homePolicyVersionsTable.policyId, policyId))
    .orderBy(desc(homePolicyVersionsTable.version));

  const current = versions[0];

  return {
    id: policy!.id,
    kind: policy!.kind,
    title: policy!.title,
    note: policy!.note,
    position: policy!.position,
    retiredAt: policy!.retiredAt,
    versionCount: versions.length,
    currentVersion: current
      ? toPolicyVersionJson(current.version, current.publishedByName)
      : null,
  };
}

function toPolicyVersionJson(row: HomePolicyVersion, publishedByName: string | null) {
  return {
    id: row.id,
    policyId: row.policyId,
    version: row.version,
    body: row.body,
    summary: row.summary,
    sourceUploadId: row.sourceUploadId,
    publishedAt: row.publishedAt,
    publishedByName,
  };
}

router.get("/policies", async (req, res) => {
  const home = tenant(req);

  const rows = await db
    .select()
    .from(homePoliciesTable)
    .where(eq(homePoliciesTable.funeralHomeId, home.id))
    .orderBy(asc(homePoliciesTable.position), asc(homePoliciesTable.id));

  res.json(await Promise.all(rows.map((row) => policyJson(row.id))));
});

router.post("/policies", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const body = parseBody(CreatePolicyBody, req.body);

  const [last] = await db
    .select({ value: max(homePoliciesTable.position) })
    .from(homePoliciesTable)
    .where(eq(homePoliciesTable.funeralHomeId, home.id));

  const [created] = await db
    .insert(homePoliciesTable)
    .values({
      funeralHomeId: home.id,
      kind: body.kind ?? "other",
      title: body.title.trim(),
      note: body.note?.trim() || null,
      position: (last?.value ?? -1) + 1,
    })
    .returning();

  await db.insert(homePolicyVersionsTable).values({
    funeralHomeId: home.id,
    policyId: created!.id,
    version: 1,
    body: body.body,
    sourceUploadId: body.sourceUploadId ?? null,
    publishedByUserId: user.id,
  });

  res.status(201).json(await policyJson(created!.id));
});

async function loadPolicy(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
) {
  const home = tenant(req);
  const id = parseId(rawId);

  const [row] = await db
    .select()
    .from(homePoliciesTable)
    .where(
      and(
        eq(homePoliciesTable.id, id),
        eq(homePoliciesTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  return requireRow(row, "That document could not be found.");
}

router.patch("/policies/:policyId", async (req, res) => {
  const policy = await loadPolicy(req, req.params.policyId);
  const body = assertHasUpdates(parseBody(UpdatePolicyBody, req.body));

  await db
    .update(homePoliciesTable)
    .set({
      ...(body.title === undefined ? {} : { title: body.title.trim() }),
      ...(body.note === undefined ? {} : { note: body.note?.trim() || null }),
      ...(body.position === undefined ? {} : { position: body.position }),
      ...(body.retired === undefined
        ? {}
        : { retiredAt: body.retired ? (policy.retiredAt ?? new Date()) : null }),
      updatedAt: new Date(),
    })
    .where(eq(homePoliciesTable.id, policy.id));

  res.json(await policyJson(policy.id));
});

router.get("/policies/:policyId/versions", async (req, res) => {
  const policy = await loadPolicy(req, req.params.policyId);

  const rows = await db
    .select({ version: homePolicyVersionsTable, publishedByName: usersTable.displayName })
    .from(homePolicyVersionsTable)
    .leftJoin(
      usersTable,
      eq(usersTable.id, homePolicyVersionsTable.publishedByUserId),
    )
    .where(eq(homePolicyVersionsTable.policyId, policy.id))
    .orderBy(desc(homePolicyVersionsTable.version));

  res.json(rows.map((row) => toPolicyVersionJson(row.version, row.publishedByName)));
});

router.post("/policies/:policyId/versions", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const policy = await loadPolicy(req, req.params.policyId);
  const body = parseBody(PublishPolicyVersionBody, req.body);

  const [last] = await db
    .select({ value: max(homePolicyVersionsTable.version) })
    .from(homePolicyVersionsTable)
    .where(eq(homePolicyVersionsTable.policyId, policy.id));

  const [created] = await db
    .insert(homePolicyVersionsTable)
    .values({
      funeralHomeId: home.id,
      policyId: policy.id,
      version: (last?.value ?? 0) + 1,
      body: body.body,
      summary: body.summary?.trim() || null,
      sourceUploadId: body.sourceUploadId ?? null,
      publishedByUserId: user.id,
    })
    .returning();

  res.status(201).json(toPolicyVersionJson(created!, user.displayName));
});

router.get("/cases/:caseId/policies", async (req, res) => {
  const row = await loadCase(req, req.params.caseId);

  const rows = await db
    .select({
      disclosure: policyDisclosuresTable,
      version: homePolicyVersionsTable,
      policy: homePoliciesTable,
      contactName: familyContactsTable.name,
    })
    .from(policyDisclosuresTable)
    .innerJoin(
      homePolicyVersionsTable,
      eq(homePolicyVersionsTable.id, policyDisclosuresTable.versionId),
    )
    .innerJoin(
      homePoliciesTable,
      eq(homePoliciesTable.id, homePolicyVersionsTable.policyId),
    )
    .innerJoin(
      familyContactsTable,
      eq(familyContactsTable.id, policyDisclosuresTable.contactId),
    )
    .where(eq(policyDisclosuresTable.caseId, row.id))
    .orderBy(desc(policyDisclosuresTable.shownAt));

  res.json(
    rows.map((entry) => ({
      id: entry.disclosure.id,
      contactId: entry.disclosure.contactId,
      contactName: entry.contactName,
      policyId: entry.policy.id,
      policyTitle: entry.policy.title,
      versionId: entry.version.id,
      version: entry.version.version,
      shownAt: entry.disclosure.shownAt,
      acknowledgedAt: entry.disclosure.acknowledgedAt,
      acknowledgedName: entry.disclosure.acknowledgedName,
    })),
  );
});

export default router;

/* ======================================================= the print sheet == */

function sendPrintable(res: Response, html: string): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // One family's paperwork, rendered for one reader: never cached by a proxy.
  res.setHeader("Cache-Control", "private, no-store");
  res.send(html);
}

/**
 * A completed form, as a sheet of paper.
 *
 * Print-ready HTML rather than a PDF built here, for the reasons
 * `print-render.ts` gives: the browser behind Ctrl-P writes a better PDF than
 * a library bolted on would, the reader can see it before they commit, and it
 * can be mailed to whoever needs a copy.
 *
 * It is also the promise that this product keeps when it is switched off.
 * Everything a family completed is printable and savable from the phone in
 * their hand, with no account and nothing of ours in the way. Documents about
 * your own mother should not be hostage to a vendor's uptime.
 */
async function renderCaseForm(input: {
  case: Case;
  home: FuneralHome;
  contact: FamilyContact | null;
  caseForm: CaseForm;
  form: HomeForm;
}): Promise<string> {
  const [fields, answers, authorizations] = await Promise.all([
    fieldsFor(input.form.id),
    answersFor(input.case.id, input.form.id),
    authorizationsFor({ caseId: input.case.id, caseFormId: input.caseForm.id }),
  ]);

  const subject = decedentDisplayName(input.case);
  const accent = /^#[0-9a-fA-F]{6}$/.test(input.home.accentColor)
    ? input.home.accentColor
    : "#1f4e46";

  const rows = fields
    .map((field) => {
      const stored = answers.get(field.key)?.value ?? "";
      const value = field.sensitive
        ? stored === ""
          ? ""
          : "given to the funeral home"
        : readStored(field, stored);

      return `<tr>
  <th scope="row">${esc(field.label)}</th>
  <td>${value === "" ? '<span class="blank">—</span>' : lines(value)}</td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(subject)} — ${esc(input.form.name)}</title>
<style>${FORM_SHEET_CSS(accent)}</style>
</head>
<body>
<div class="sheet">
  <header class="letterhead">
    <p class="home">${esc(input.home.name)}</p>
    ${input.home.phone ? `<p class="meta">${esc(input.home.phone)}</p>` : ""}
  </header>
  <h1>${esc(input.form.name)}</h1>
  <p class="subject">${esc(subject)}</p>
  ${input.form.note ? `<p class="note">${esc(input.form.note)}</p>` : ""}
  ${
    fields.length === 0
      ? '<p class="blank">This form has no questions on it yet.</p>'
      : `<table>${rows}</table>`
  }
  ${authorizations.map(authorizationBlock).join("\n")}
  <p class="footer">Printed ${esc(
    new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  )} · ${esc(input.home.name)}</p>
</div>
</body>
</html>`;
}

function authorizationBlock(
  authorization: Awaited<ReturnType<typeof authorizationsFor>>[number],
): string {
  const day = (value: Date) =>
    value.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

  const consents =
    authorization.consents.length === 0
      ? ""
      : `<p class="consent-heading">Consenting:</p>
<ul class="consents">
${authorization.consents
  .map(
    (consent) =>
      `<li>${esc(consent.personName)}${
        consent.relationship ? `, ${esc(consent.relationship)}` : ""
      } — ${esc(day(consent.consentedAt))}, ${esc(
        consent.channel.replace(/_/g, " "),
      )}</li>`,
  )
  .join("\n")}
</ul>`;

  return `<section class="authorization">
  <h2>Authorization</h2>
  <p><strong>${esc(authorization.signedName)}</strong>${
    authorization.signedRelationship
      ? `, ${esc(authorization.signedRelationship)}`
      : ""
  } — ${esc(day(authorization.signedAt))}</p>
  <p class="tier">Claimed as: ${esc(
    authorization.claimedTier.replace(/_/g, " "),
  )}${
    authorization.requiresMajority
      ? ` · a tier requiring a majority${
          authorization.tierMemberCount === null
            ? ""
            : ` of ${authorization.tierMemberCount}`
        }`
      : ""
  }</p>
  ${
    authorization.verifiedByName
      ? `<p class="verified">Verified by ${esc(authorization.verifiedByName)}${
          authorization.verifiedAt ? ` on ${esc(day(authorization.verifiedAt))}` : ""
        }${
          authorization.verificationNote
            ? ` — ${esc(authorization.verificationNote)}`
            : ""
        }</p>`
      : '<p class="verified unverified">Not yet verified by the funeral home.</p>'
  }
  ${consents}
</section>`;
}

const FORM_SHEET_CSS = (accent: string) => `
  :root { --accent: ${accent}; }
  @page { size: letter; margin: 0.75in; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #f6f4f1;
    color: #1c1b19;
    font-family: "Nunito", ui-sans-serif, system-ui, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
  }
  .sheet {
    max-width: 7in;
    margin: 0 auto;
    padding: 0.6in 0.5in;
    background: #fff;
  }
  .letterhead { border-bottom: 1.5pt solid var(--accent); padding-bottom: 0.1in; }
  .home { margin: 0; font-size: 12pt; font-weight: 700; letter-spacing: 0.01em; }
  .meta { margin: 0.03in 0 0; font-size: 9.5pt; color: #55514c; }
  h1 {
    font-family: "Lora", Georgia, serif;
    font-size: 17pt;
    font-weight: 600;
    margin: 0.28in 0 0.04in;
  }
  .subject { margin: 0; font-size: 12pt; }
  .note { margin: 0.06in 0 0; font-size: 10pt; color: #55514c; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.26in; }
  th, td {
    text-align: left;
    vertical-align: top;
    padding: 0.09in 0;
    border-bottom: 0.5pt solid #e2ded8;
  }
  th { width: 38%; font-weight: 600; padding-right: 0.2in; }
  .blank { color: #8a857e; }
  .authorization {
    margin-top: 0.3in;
    padding: 0.16in 0.18in;
    border: 0.75pt solid #d9d4cc;
    break-inside: avoid;
  }
  .authorization h2 {
    font-family: "Lora", Georgia, serif;
    font-size: 12pt;
    margin: 0 0 0.08in;
  }
  .authorization p { margin: 0 0 0.05in; }
  .tier, .verified { font-size: 10pt; color: #55514c; }
  .unverified { font-style: italic; }
  .consent-heading { margin-top: 0.1in; font-size: 10pt; font-weight: 600; }
  .consents { margin: 0.04in 0 0; padding-left: 0.2in; font-size: 10pt; }
  .footer { margin-top: 0.3in; font-size: 9pt; color: #8a857e; }
  @media print {
    body { background: #fff; }
    .sheet { max-width: none; padding: 0; }
  }
`;

/* ============================================== the family's own forms == */

/**
 * Mounted under `/family`, on the same mount as the rest of the family
 * surface, so the link token is resolved once per request rather than twice.
 * No path here carries a case id: the token already names the case.
 *
 * Note what is missing: the 72-hour clock. A countdown is the right thing to
 * put in front of a director and the wrong thing to put in front of a widow,
 * so the urgency reaches this surface as an ordering — the certificate's
 * questions come first — and never as a number of hours.
 */
export const familyFormsRouter: IRouter = Router();

/**
 * The level the home set on the form, checked against the level the home set
 * on the person.
 *
 * The comparison is `atLeast` from Component 1, not a second permission model
 * — the level required is a property of the form and so cannot be named when
 * the route is mounted, but the question being asked is theirs and so is the
 * answer. Anything that records an authorization carries
 * `requireFamilyAuthorization` as real middleware instead.
 */
function assertMayComplete(contact: FamilyContact, form: HomeForm): void {
  if (atLeast(contact, form.requiredLevel as FamilyAccessLevel)) return;

  throw new HttpError(
    403,
    form.requiredLevel === "authorizing"
      ? "Only the person the funeral home has recorded as authorizing this " +
        "funeral can complete this one, and they will need their password."
      : "Whoever the funeral home has recorded as arranging the funeral " +
        "needs to do this part. They can share it with you.",
  );
}

async function loadSharedForm(
  req: Parameters<typeof familyCase>[0] & Parameters<typeof familyContact>[0],
  rawId: string | undefined,
): Promise<{ caseForm: CaseForm; form: HomeForm }> {
  const subject = familyCase(req);
  const contact = familyContact(req);
  const found = await loadCaseForm(subject.funeralHomeId, subject.id, rawId);

  // An unshared form is not "forbidden", it is not there yet — a director is
  // still preparing it, and saying so would be telling a family about a
  // document the home has not decided to give them.
  if (!found.caseForm.sharedWithFamily) {
    throw new HttpError(404, "That form could not be found.");
  }

  if (!atLeast(contact, found.form.requiredLevel as FamilyAccessLevel)) {
    throw new HttpError(404, "That form could not be found.");
  }

  return found;
}

familyFormsRouter.get("/forms", async (req, res) => {
  const subject = familyCase(req);
  const contact = familyContact(req);

  res.json(
    await caseFormsFor({ case: subject, onlyShared: true, visibleTo: contact }),
  );
});

familyFormsRouter.get("/forms/:caseFormId", async (req, res) => {
  const subject = familyCase(req);
  const home = familyHome(req);
  const contact = familyContact(req);
  const { caseForm, form } = await loadSharedForm(req, req.params.caseFormId);

  res.json(
    await caseFormDetail({
      case: subject,
      home,
      contact,
      caseForm,
      form,
      forStaff: false,
    }),
  );
});

familyFormsRouter.put("/forms/:caseFormId/answers", async (req, res) => {
  const subject = familyCase(req);
  const home = familyHome(req);
  const contact = familyContact(req);
  const { caseForm, form } = await loadSharedForm(req, req.params.caseFormId);

  assertMayComplete(contact, form);
  await assertNotAlreadySigned(subject.id, caseForm.id);

  const body = parseBody(SetFamilyFormAnswersBody, req.body);

  await storeAnswers({
    funeralHomeId: subject.funeralHomeId,
    caseId: subject.id,
    form,
    caseForm,
    fields: await fieldsFor(form.id),
    answers: body.answers,
    // A pre-need case is a person filling in their own paperwork while they
    // are well. Recording that as `self` is what lets their family, years
    // later, be told he answered this himself rather than wonder who did.
    source: subject.kind === "pre_need" ? "self" : "family",
  });

  res.json(
    await caseFormDetail({
      case: subject,
      home,
      contact,
      caseForm,
      form,
      forStaff: false,
    }),
  );
});

familyFormsRouter.get("/forms/:caseFormId/render", async (req, res) => {
  const subject = familyCase(req);
  const home = familyHome(req);
  const contact = familyContact(req);
  const { caseForm, form } = await loadSharedForm(req, req.params.caseFormId);

  sendPrintable(
    res,
    await renderCaseForm({ case: subject, home, contact, caseForm, form }),
  );
});

/**
 * Signing an authorization.
 *
 * `requireFamilyAuthorization` is Component 1's and does four things before
 * this handler runs: the contact holds the right of final disposition, a
 * director recorded which tier of C.R.S. 15-19-106 that was under, they typed
 * their password rather than merely holding a forwarded link, and the case is
 * not marked disputed.
 *
 * On a tier that needs a majority, a second authorizing contact signing the
 * same document adds their own consent to what is already recorded rather
 * than opening a rival authorization. Nobody consents on anybody else's
 * behalf here: a daughter typing "my brother agreed" is her assertion, and
 * that is the exact thing the majority rule exists to prevent.
 */
familyFormsRouter.post<{ caseFormId: string }>(
  "/forms/:caseFormId/authorize",
  requireFamilyAuthorization,
  async (req, res) => {
    const subject = familyCase(req);
    const contact = familyContact(req);
    const { caseForm, form } = await loadSharedForm(req, req.params.caseFormId);

    if (form.kind !== "authorization") {
      throw badRequest("That form is not an authorization.");
    }

    const body = parseBody(AuthorizeFamilyFormBody, req.body);

    // `requireFamilyAuthorization` has already established that the home
    // recorded a tier against this person; this satisfies the compiler.
    const tier = (contact.dispositionTier ?? "").trim();
    if (tier === "") {
      throw new HttpError(
        403,
        "The funeral home has not yet recorded how you are authorized to " +
          "sign this. They will be in touch.",
      );
    }

    const requiresMajority = tierRequiresMajority(tier);
    const signedName = body.signedName.trim();
    const now = new Date();

    const existing = requiresMajority
      ? await openMajorityAuthorization(subject.id, caseForm.id, tier)
      : null;

    if (existing) {
      const already = await db
        .select({ id: caseAuthorizationConsentsTable.id })
        .from(caseAuthorizationConsentsTable)
        .where(
          and(
            eq(caseAuthorizationConsentsTable.authorizationId, existing.id),
            eq(caseAuthorizationConsentsTable.contactId, contact.id),
          ),
        )
        .limit(1);

      if (already.length === 0) {
        await db.insert(caseAuthorizationConsentsTable).values({
          funeralHomeId: subject.funeralHomeId,
          caseId: subject.id,
          authorizationId: existing.id,
          personName: signedName,
          relationship: body.signedRelationship?.trim() || contact.relationship,
          contactId: contact.id,
          channel: "portal",
          consentedAt: now,
          signedIp: req.ip ?? null,
        });
      }

      const [json] = await authorizationsFor({
        caseId: subject.id,
        authorizationId: existing.id,
      });

      res.status(201).json(json);
      return;
    }

    const answers = await answersFor(subject.id, form.id);

    const [created] = await db
      .insert(caseAuthorizationsTable)
      .values({
        funeralHomeId: subject.funeralHomeId,
        caseId: subject.id,
        caseFormId: caseForm.id,
        claimedTier: tier,
        requiresMajority,
        signedByContactId: contact.id,
        signedName,
        signedRelationship: body.signedRelationship?.trim() || contact.relationship,
        signedAt: now,
        signedIp: req.ip ?? null,
        answersSnapshot: snapshotOf(answers),
      })
      .returning();

    // The signer is a consenting person in their own right, and on a majority
    // tier they are the first of several. Recording them here rather than
    // inferring them from `signedName` later means one place counts consents.
    await db.insert(caseAuthorizationConsentsTable).values({
      funeralHomeId: subject.funeralHomeId,
      caseId: subject.id,
      authorizationId: created!.id,
      personName: signedName,
      relationship: body.signedRelationship?.trim() || contact.relationship,
      contactId: contact.id,
      channel: "portal",
      consentedAt: now,
      signedIp: req.ip ?? null,
    });

    await db
      .update(caseFormsTable)
      .set({ completedAt: caseForm.completedAt ?? now, updatedAt: now })
      .where(eq(caseFormsTable.id, caseForm.id));

    const [json] = await authorizationsFor({
      caseId: subject.id,
      authorizationId: created!.id,
    });

    res.status(201).json(json);
  },
);

/** The most recent authorization on this document under the same tier. */
async function openMajorityAuthorization(
  caseId: number,
  caseFormId: number,
  tier: string,
): Promise<CaseAuthorization | undefined> {
  const [row] = await db
    .select()
    .from(caseAuthorizationsTable)
    .where(
      and(
        eq(caseAuthorizationsTable.caseId, caseId),
        eq(caseAuthorizationsTable.caseFormId, caseFormId),
        eq(caseAuthorizationsTable.claimedTier, tier),
      ),
    )
    .orderBy(desc(caseAuthorizationsTable.signedAt))
    .limit(1);

  return row;
}

/* --------------------------------------------- the family's own policies -- */

familyFormsRouter.get("/policies", async (req, res) => {
  const subject = familyCase(req);
  const contact = familyContact(req);

  const rows = await db
    .select({ policy: homePoliciesTable, version: homePolicyVersionsTable })
    .from(homePoliciesTable)
    .innerJoin(
      homePolicyVersionsTable,
      eq(homePolicyVersionsTable.policyId, homePoliciesTable.id),
    )
    .where(eq(homePoliciesTable.funeralHomeId, subject.funeralHomeId))
    .orderBy(asc(homePoliciesTable.position), desc(homePolicyVersionsTable.version));

  const current = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.policy.retiredAt !== null) continue;
    if (!current.has(row.policy.id)) current.set(row.policy.id, row);
  }

  const versionIds = [...current.values()].map((row) => row.version.id);

  if (versionIds.length > 0) {
    // Recording that they were shown it is a side effect of the read, which
    // is normally worth avoiding. Here it is the honest option: the fact
    // worth keeping is that the words were in front of them, and that becomes
    // true when the page renders rather than when a later request happens to
    // succeed. The storefront records a price list the same way.
    await db
      .insert(policyDisclosuresTable)
      .values(
        versionIds.map((versionId) => ({
          funeralHomeId: subject.funeralHomeId,
          caseId: subject.id,
          versionId,
          contactId: contact.id,
        })),
      )
      .onConflictDoNothing({
        target: [policyDisclosuresTable.versionId, policyDisclosuresTable.contactId],
      });
  }

  const disclosures = await disclosuresFor(contact.id, versionIds);

  res.json(
    [...current.values()].map((row) => {
      const disclosure = disclosures.get(row.version.id);

      return {
        id: row.policy.id,
        kind: row.policy.kind,
        title: row.policy.title,
        note: row.policy.note,
        versionId: row.version.id,
        version: row.version.version,
        body: row.version.body,
        sourceUploadId: row.version.sourceUploadId,
        publishedAt: row.version.publishedAt,
        shownAt: disclosure?.shownAt ?? null,
        acknowledgedAt: disclosure?.acknowledgedAt ?? null,
      };
    }),
  );
});

type Disclosure = typeof policyDisclosuresTable.$inferSelect;

async function disclosuresFor(
  contactId: number,
  versionIds: number[],
): Promise<Map<number, Disclosure>> {
  if (versionIds.length === 0) return new Map();

  const rows = await db
    .select()
    .from(policyDisclosuresTable)
    .where(
      and(
        eq(policyDisclosuresTable.contactId, contactId),
        inArray(policyDisclosuresTable.versionId, versionIds),
      ),
    );

  return new Map(rows.map((row) => [row.versionId, row]));
}

familyFormsRouter.post("/policies/:versionId/acknowledge", async (req, res) => {
  const subject = familyCase(req);
  const contact = familyContact(req);
  const body = parseBody(AcknowledgeFamilyPolicyBody, req.body);
  const versionId = parseId(req.params.versionId);

  const [found] = await db
    .select({ policy: homePoliciesTable, version: homePolicyVersionsTable })
    .from(homePolicyVersionsTable)
    .innerJoin(
      homePoliciesTable,
      eq(homePoliciesTable.id, homePolicyVersionsTable.policyId),
    )
    .where(
      and(
        eq(homePolicyVersionsTable.id, versionId),
        eq(homePolicyVersionsTable.funeralHomeId, subject.funeralHomeId),
      ),
    )
    .limit(1);

  requireRow(found, "That document could not be found.");

  const now = new Date();

  await db
    .insert(policyDisclosuresTable)
    .values({
      funeralHomeId: subject.funeralHomeId,
      caseId: subject.id,
      versionId,
      contactId: contact.id,
      acknowledgedAt: now,
      acknowledgedName: body.name.trim(),
      acknowledgedIp: req.ip ?? null,
    })
    .onConflictDoUpdate({
      target: [policyDisclosuresTable.versionId, policyDisclosuresTable.contactId],
      set: {
        acknowledgedAt: now,
        acknowledgedName: body.name.trim(),
        acknowledgedIp: req.ip ?? null,
      },
    });

  const [disclosure] = await db
    .select()
    .from(policyDisclosuresTable)
    .where(
      and(
        eq(policyDisclosuresTable.versionId, versionId),
        eq(policyDisclosuresTable.contactId, contact.id),
      ),
    )
    .limit(1);

  res.json({
    id: found!.policy.id,
    kind: found!.policy.kind,
    title: found!.policy.title,
    note: found!.policy.note,
    versionId: found!.version.id,
    version: found!.version.version,
    body: found!.version.body,
    sourceUploadId: found!.version.sourceUploadId,
    publishedAt: found!.version.publishedAt,
    shownAt: disclosure?.shownAt ?? null,
    acknowledgedAt: disclosure?.acknowledgedAt ?? null,
  });
});

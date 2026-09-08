import { and, asc, eq } from "drizzle-orm";
import {
  db,
  caseBelongingsTable,
  casePreparationTable,
  casePhotosTable,
  familyContactsTable,
  usersTable,
  DEFAULT_BELONGING_PROMPTS,
  type CaseBelonging,
  type CasePreparation,
} from "@workspace/db";

/**
 * Shared reads for the items a family brings in and the preparation sheet.
 *
 * Both surfaces show the same rows; what differs is who is allowed to move
 * one through the chain of custody. That rule lives in the routes, not here.
 */

/** Items with the staff names resolved, because "received by" needs a person. */
export async function belongingsForCase(caseId: number, funeralHomeId: number) {
  const rows = await db
    .select({
      item: caseBelongingsTable,
      receivedByName: usersTable.displayName,
      returnedToContactName: familyContactsTable.name,
    })
    .from(caseBelongingsTable)
    .leftJoin(usersTable, eq(usersTable.id, caseBelongingsTable.receivedByUserId))
    .leftJoin(
      familyContactsTable,
      eq(familyContactsTable.id, caseBelongingsTable.returnedToContactId),
    )
    .where(
      and(
        eq(caseBelongingsTable.caseId, caseId),
        eq(caseBelongingsTable.funeralHomeId, funeralHomeId),
      ),
    )
    .orderBy(asc(caseBelongingsTable.position), asc(caseBelongingsTable.id));

  return rows.map(({ item, receivedByName, returnedToContactName }) => ({
    id: item.id,
    caseId: item.caseId,
    kind: item.kind,
    description: item.description,
    disposition: item.disposition,
    status: item.status,
    photoUploadId: item.photoUploadId,
    notes: item.notes,
    receivedAt: item.receivedAt,
    receivedByName,
    returnedAt: item.returnedAt,
    // Whoever actually collected it: a named contact if we know them,
    // otherwise whatever was typed at the desk.
    returnedToName: item.returnedToName ?? returnedToContactName,
    position: item.position,
  }));
}

/**
 * Seed the standard prompts the first time a case's list is opened.
 *
 * Created lazily rather than with the case, because most of these questions
 * only become relevant once there is going to be a viewing -- and a list of
 * five unanswered items sitting on a case opened at 3am is noise.
 */
export async function ensureBelongingPrompts(
  caseId: number,
  funeralHomeId: number,
): Promise<void> {
  const [existing] = await db
    .select({ id: caseBelongingsTable.id })
    .from(caseBelongingsTable)
    .where(eq(caseBelongingsTable.caseId, caseId))
    .limit(1);

  if (existing) return;

  await db.insert(caseBelongingsTable).values(
    DEFAULT_BELONGING_PROMPTS.map((prompt, position) => ({
      funeralHomeId,
      caseId,
      kind: prompt.kind,
      description: prompt.description,
      disposition: prompt.disposition,
      position,
    })),
  );
}

/** The preparation sheet, created on first read so callers never see null. */
export async function preparationForCase(
  caseId: number,
  funeralHomeId: number,
): Promise<CasePreparation> {
  const [existing] = await db
    .select()
    .from(casePreparationTable)
    .where(
      and(
        eq(casePreparationTable.caseId, caseId),
        eq(casePreparationTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(casePreparationTable)
    .values({ funeralHomeId, caseId })
    // Two tabs opening the sheet at once must not race into two rows.
    .onConflictDoNothing({ target: casePreparationTable.caseId })
    .returning();

  if (created) return created;

  const [raced] = await db
    .select()
    .from(casePreparationTable)
    .where(eq(casePreparationTable.caseId, caseId))
    .limit(1);

  return raced!;
}

/** The sheet as the API describes it, with the reference photo resolved. */
export async function toPreparationJson(
  row: CasePreparation,
  referencePhotoId: number | null,
) {
  let referencePhotoUploadId: number | null = null;

  if (referencePhotoId !== null) {
    const [photo] = await db
      .select({ uploadId: casePhotosTable.uploadId })
      .from(casePhotosTable)
      .where(eq(casePhotosTable.id, referencePhotoId))
      .limit(1);
    referencePhotoUploadId = photo?.uploadId ?? null;
  }

  let reviewedByName: string | null = null;

  if (row.reviewedByUserId !== null) {
    const [user] = await db
      .select({ displayName: usersTable.displayName })
      .from(usersTable)
      .where(eq(usersTable.id, row.reviewedByUserId))
      .limit(1);
    reviewedByName = user?.displayName ?? null;
  }

  return {
    caseId: row.caseId,
    hairNotes: row.hairNotes,
    cosmeticsNotes: row.cosmeticsNotes,
    nailNotes: row.nailNotes,
    glassesWorn: row.glassesWorn,
    dentures: row.dentures,
    jewelleryNotes: row.jewelleryNotes,
    otherNotes: row.otherNotes,
    referencePhotoUploadId,
    reviewedAt: row.reviewedAt,
    reviewedByName,
  };
}

export type BelongingRow = CaseBelonging;

import { and, asc, eq, max } from "drizzle-orm";
import {
  db,
  caseMemoriesTable,
  familyContactsTable,
  usersTable,
  type CaseMemory,
} from "@workspace/db";

/**
 * Reading memories back, with a name against each one.
 *
 * The name is resolved here rather than stored denormalised, because the two
 * sources that can change — a contact who was added as "Anne" and later
 * corrected to "Anne Hale", a director whose display name is fixed after a
 * typo — should correct everywhere at once. The third source cannot change
 * and is not resolved: `authorName` on a tribute is free text naming somebody
 * with no row anywhere, and it is the only record of who gave the eulogy.
 */

export type MemoryJson = {
  id: number;
  caseId: number;
  kind: string;
  prompt: string | null;
  body: string;
  authorName: string | null;
  authorSide: "family" | "home" | "other";
  authorContactId: number | null;
  forOfficiant: boolean;
  position: number;
  createdAt: Date;
};

type Row = {
  memory: CaseMemory;
  contactName: string | null;
  userName: string | null;
};

function toJson(row: Row): MemoryJson {
  const { memory } = row;

  /*
   * Which of the three author columns is set decides both the name and the
   * side. A tribute typed up by a director is `other` rather than `home`:
   * the home recorded it, but the minister said it, and a family reading
   * back what was said at the graveside should see the minister's name
   * against it and not the funeral director's.
   */
  const [authorName, authorSide]: [string | null, MemoryJson["authorSide"]] =
    memory.authorName
      ? [memory.authorName, "other"]
      : memory.authorContactId !== null
        ? [row.contactName, "family"]
        : memory.authorUserId !== null
          ? [row.userName, "home"]
          : [null, "other"];

  return {
    id: memory.id,
    caseId: memory.caseId,
    kind: memory.kind,
    prompt: memory.prompt,
    body: memory.body,
    authorName,
    authorSide,
    authorContactId: memory.authorContactId,
    forOfficiant: memory.forOfficiant,
    position: memory.position,
    createdAt: memory.createdAt,
  };
}

export async function memoriesForCase(
  caseId: number,
  funeralHomeId: number,
): Promise<MemoryJson[]> {
  const rows = await db
    .select({
      memory: caseMemoriesTable,
      contactName: familyContactsTable.name,
      userName: usersTable.displayName,
    })
    .from(caseMemoriesTable)
    .leftJoin(
      familyContactsTable,
      eq(familyContactsTable.id, caseMemoriesTable.authorContactId),
    )
    .leftJoin(usersTable, eq(usersTable.id, caseMemoriesTable.authorUserId))
    .where(
      and(
        eq(caseMemoriesTable.caseId, caseId),
        eq(caseMemoriesTable.funeralHomeId, funeralHomeId),
      ),
    )
    // Oldest first. These are read as a sequence — a family scrolling what
    // they have written so far, a minister reading down a sheet — and newest
    // first would put the thing somebody added as an afterthought above the
    // story they sat down to write.
    .orderBy(asc(caseMemoriesTable.position), asc(caseMemoriesTable.id));

  return rows.map(toJson);
}

export async function memoryById(
  id: number,
  funeralHomeId: number,
): Promise<MemoryJson | undefined> {
  const rows = await db
    .select({
      memory: caseMemoriesTable,
      contactName: familyContactsTable.name,
      userName: usersTable.displayName,
    })
    .from(caseMemoriesTable)
    .leftJoin(
      familyContactsTable,
      eq(familyContactsTable.id, caseMemoriesTable.authorContactId),
    )
    .leftJoin(usersTable, eq(usersTable.id, caseMemoriesTable.authorUserId))
    .where(
      and(
        eq(caseMemoriesTable.id, id),
        eq(caseMemoriesTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  return rows[0] ? toJson(rows[0]) : undefined;
}

/** Next position on a case, so a new one lands at the bottom of the list. */
export async function nextMemoryPosition(
  caseId: number,
  funeralHomeId: number,
): Promise<number> {
  const [row] = await db
    .select({ highest: max(caseMemoriesTable.position) })
    .from(caseMemoriesTable)
    .where(
      and(
        eq(caseMemoriesTable.caseId, caseId),
        eq(caseMemoriesTable.funeralHomeId, funeralHomeId),
      ),
    );

  return (row?.highest ?? -1) + 1;
}

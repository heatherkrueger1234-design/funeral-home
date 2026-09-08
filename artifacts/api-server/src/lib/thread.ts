import { and, asc, eq, isNull } from "drizzle-orm";
import {
  db,
  caseMessagesTable,
  familyContactsTable,
  usersTable,
  type Case,
  type CaseMessage,
  type FuneralHome,
} from "@workspace/db";
import { isWithinOfficeHours } from "./office-hours";

/**
 * The one thread per case, rendered for whichever side is reading it.
 *
 * `authorSide` is derived from which author column is set rather than stored
 * as its own column, so the two can never disagree about who wrote something.
 */

export type ThreadOptions = {
  case: Case;
  home: FuneralHome;
  now?: Date;
};

/** A thread is locked once the case's lock date has passed. */
export function isThreadLocked(row: Case, now = new Date()): boolean {
  return row.messagesLockAt !== null && row.messagesLockAt <= now;
}

export async function buildThread({ case: row, home, now = new Date() }: ThreadOptions) {
  const rows = await db
    .select({
      message: caseMessagesTable,
      staffName: usersTable.displayName,
      staffTitle: usersTable.title,
      contactName: familyContactsTable.name,
      contactRelationship: familyContactsTable.relationship,
    })
    .from(caseMessagesTable)
    .leftJoin(usersTable, eq(usersTable.id, caseMessagesTable.authorUserId))
    .leftJoin(
      familyContactsTable,
      eq(familyContactsTable.id, caseMessagesTable.authorContactId),
    )
    .where(eq(caseMessagesTable.caseId, row.id))
    .orderBy(asc(caseMessagesTable.createdAt), asc(caseMessagesTable.id));

  const messages = rows.map(
    ({ message, staffName, staffTitle, contactName, contactRelationship }) => {
      const fromHome = message.authorUserId !== null;
      return {
        id: message.id,
        caseId: message.caseId,
        body: message.body,
        authorSide: fromHome ? ("home" as const) : ("family" as const),
        authorName: fromHome ? staffName : contactName,
        authorTitle: fromHome ? staffTitle : contactRelationship,
        sentOutsideOfficeHours: message.sentOutsideOfficeHours !== null,
        readAt: message.readAt,
        createdAt: message.createdAt,
      };
    },
  );

  return {
    messages,
    locked: isThreadLocked(row, now),
    lockedAt: row.messagesLockAt,
    withinOfficeHours: isWithinOfficeHours(home, now),
    officeOpensMinute: home.officeOpensMinute,
    officeClosesMinute: home.officeClosesMinute,
    timezone: home.timezone,
    urgentPhone: home.urgentPhone,
  };
}

/**
 * Mark the other side's messages read.
 *
 * Which messages count as "the other side's" depends on who is looking, so
 * the caller says. Deliberately not awaited by the read path in a way that
 * could fail it: a read receipt is not worth a failed page load.
 */
export async function markRead(
  caseId: number,
  side: "home" | "family",
  now = new Date(),
): Promise<void> {
  await db
    .update(caseMessagesTable)
    .set({ readAt: now })
    .where(
      and(
        eq(caseMessagesTable.caseId, caseId),
        isNull(caseMessagesTable.readAt),
        // The home reads what the family wrote, and vice versa.
        side === "home"
          ? isNull(caseMessagesTable.authorUserId)
          : isNull(caseMessagesTable.authorContactId),
      ),
    );
}

export type PostedMessage = CaseMessage;

/**
 * The work behind `fix-plan-records.ts`; see that file for what and why.
 * Kept apart from the command so the API's test suite can run it against a
 * real database with plans in every state it handles.
 */
import {
  aftercareEnrollmentsTable,
  casesTable,
  db,
  familyContactsTable,
  informantIsTheSubject,
  intakeRequestsTable,
  namesOnFile,
  vitalStatisticsTable,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
}

export type Change = { what: string; caseId: number; homeId: number };

/** Everything it did (or would do), and what it left for a person. */
export async function fixPlanRecords(options: {
  apply: boolean;
}): Promise<{ changes: Change[]; review: Change[] }> {
  const APPLY = options.apply;
  const changes: Change[] = [];
  const review: Change[] = [];

  await db.transaction(async (tx) => {
    const [cases, contacts, intakes, vitals] = await Promise.all([
      tx.select().from(casesTable),
      tx.select().from(familyContactsTable),
      tx
        .select()
        .from(intakeRequestsTable)
        .where(eq(intakeRequestsTable.kind, "pre_need")),
      tx.select().from(vitalStatisticsTable),
    ]);

    const contactsOf = (caseId: number) => contacts.filter((c) => c.caseId === caseId);

    /* --------------------------------------------- 1. who the plan is for */

    for (const row of cases) {
      const onCase = contactsOf(row.id);
      if (onCase.some((c) => c.isSubject)) continue;

      const request = intakes.find((intake) => intake.caseId === row.id);
      const planner = request
        ? onCase.find((c) => same(c.name, request.requesterName))
        : undefined;

      if (planner) {
        changes.push({
          what: `contact ${planner.id} marked as the person the plan is for`,
          caseId: row.id,
          homeId: row.funeralHomeId,
        });
        // Marked in memory too, so steps 2 and 3 see it on a dry run.
        planner.isSubject = true;
        if (APPLY) {
          await tx
            .update(familyContactsTable)
            .set({ isSubject: true, updatedAt: new Date() })
            .where(eq(familyContactsTable.id, planner.id));
        }
      } else if (row.kind === "pre_need" && onCase.length > 0) {
        review.push({
          what: "a plan with family on it and nobody marked as the planner; tick them in the console if one of them is",
          caseId: row.id,
          homeId: row.funeralHomeId,
        });
      }
    }

    /* ---------------------------------------- 2. a planner who has died */

    for (const row of cases) {
      if (row.kind === "pre_need") continue;
      for (const planner of contactsOf(row.id).filter((c) => c.isSubject)) {
        const live = planner.revokedAt === null;
        const stillKin = planner.role === "next_of_kin" || planner.canInvite;
        if (live || stillKin) {
          changes.push({
            what: `contact ${planner.id}, who has died: link closed, no longer next of kin`,
            caseId: row.id,
            homeId: row.funeralHomeId,
          });
          if (APPLY) {
            await tx
              .update(familyContactsTable)
              .set({
                revokedAt: planner.revokedAt ?? new Date(),
                role: "contributor",
                canInvite: false,
                updatedAt: new Date(),
              })
              .where(eq(familyContactsTable.id, planner.id));
          }
        }

        const enrolled = await tx
          .select({ id: aftercareEnrollmentsTable.id })
          .from(aftercareEnrollmentsTable)
          .where(
            and(
              eq(aftercareEnrollmentsTable.contactId, planner.id),
              isNull(aftercareEnrollmentsTable.unsubscribedAt),
            ),
          );
        for (const enrolment of enrolled) {
          changes.push({
            what: `aftercare enrolment ${enrolment.id} for the person who died: stopped`,
            caseId: row.id,
            homeId: row.funeralHomeId,
          });
          if (APPLY) {
            await tx
              .update(aftercareEnrollmentsTable)
              .set({ unsubscribedAt: new Date(), updatedAt: new Date() })
              .where(eq(aftercareEnrollmentsTable.id, enrolment.id));
          }
        }
      }
    }

    /* ------------------------------ 3. informant on their own certificate */

    for (const record of vitals) {
      if (!record.informantName) continue;
      const row = cases.find((c) => c.id === record.caseId);
      if (!row) continue;

      const planners = contactsOf(row.id).filter((c) => c.isSubject);
      const names = [...namesOnFile(row, record), ...planners.map((p) => p.name)];
      if (!informantIsTheSubject(record.informantName, names)) continue;

      const wasAPlan = row.kind === "pre_need" || planners.length > 0;
      if (!wasAPlan) {
        review.push({
          what: `certificate record ${record.id}: the informant has the same name as the person who died`,
          caseId: row.id,
          homeId: row.funeralHomeId,
        });
        continue;
      }

      changes.push({
        what: `certificate record ${record.id}: the planner removed as their own informant`,
        caseId: row.id,
        homeId: row.funeralHomeId,
      });
      if (APPLY) {
        await tx
          .update(vitalStatisticsTable)
          .set({
            informantName: null,
            informantRelationship: null,
            informantPhone: null,
            updatedAt: new Date(),
          })
          .where(eq(vitalStatisticsTable.id, record.id));
      }
    }
  });

  return { changes, review };
}

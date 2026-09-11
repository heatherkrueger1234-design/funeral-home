import { eq, sql } from "drizzle-orm";
import { db, funeralHomesTable, type OnboardingStep } from "@workspace/db";
import { logger } from "./logger";

/**
 * Ticking setup steps off as they actually happen.
 *
 * A checklist a director has to tick themselves is a checklist that stays
 * unticked while the work is done anyway — so opening a case marks "open your
 * first case", and texting a link marks "send a family their link". The list
 * then reflects reality rather than diligence.
 *
 * Never allowed to fail the request it rode in on: a home that opened a case
 * has opened a case, whether or not the checkbox got written.
 */
export async function markOnboarding(
  funeralHomeId: number,
  step: OnboardingStep,
): Promise<void> {
  try {
    /*
     * Appended in SQL rather than read-modify-written, so two things
     * finishing at once cannot lose one of the steps. The guard stops the
     * same step being appended twice.
     */
    await db
      .update(funeralHomesTable)
      .set({
        onboardingDone: sql`
          case
            when ${funeralHomesTable.onboardingDone} = '' then ${step}
            else ${funeralHomesTable.onboardingDone} || ',' || ${step}
          end
        `,
        updatedAt: new Date(),
      })
      .where(
        sql`${funeralHomesTable.id} = ${funeralHomeId}
            and not (',' || ${funeralHomesTable.onboardingDone} || ',')
                    like ${'%,' + step + ',%'}`,
      );
  } catch (err) {
    logger.warn({ err, step }, "Could not record an onboarding step");
  }
  void eq;
}

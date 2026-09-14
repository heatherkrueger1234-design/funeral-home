import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { funeralHomesTable } from "./funeral-homes";

/**
 * The home's standard schedule, as offsets from the service.
 *
 * This exists because of an uncomfortable observation about the timeline
 * feature it feeds: a director will not hand-build a five-item schedule for
 * every case. They have four funerals this week. Left to manual entry the
 * timeline stays empty, the family is never told when their clothing is due,
 * and the thing the product is sold on quietly does not happen.
 *
 * So the home writes its schedule once -- the same one it already runs in its
 * head -- and every case gets it automatically the moment a service date
 * exists. `offsetMinutes` is relative to that date and is usually negative:
 * "three days before" is -4320.
 *
 * Offsets rather than fixed weekdays because a funeral on a Saturday and a
 * funeral on a Tuesday need the same three days of notice, not the same
 * calendar day. The one thing this deliberately cannot express is "the second
 * Tuesday", which no funeral home has ever needed.
 */
export const timelineTemplatesTable = pgTable(
  "timeline_templates",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    description: text("description"),

    /**
     * What the offset is counted from.
     *
     * `service` is the original and still the common case: "photographs in,
     * four days before the funeral". `opened` counts from the moment the home
     * took the person into its care, and exists because plenty of a home's
     * standard schedule has nothing to do with the funeral date — "clothing
     * within 48 hours of us collecting her" is a promise about the care of a
     * body, and pinning it to a service date that may not be set for another
     * three days gets it wrong in both directions.
     *
     * A schedule mixes the two freely, and the family sees one merged list in
     * date order.
     */
    anchor: text("anchor").notNull().default("service"),

    /**
     * Minutes relative to whichever anchor. Negative is before it, which is
     * where almost everything on a service anchor lives; positive is normal
     * on an `opened` anchor and is also for the few things that follow a
     * funeral, like collecting the flowers.
     */
    offsetMinutes: integer("offset_minutes").notNull(),

    /** The service itself, and anything else that happens rather than is due. */
    isEvent: boolean("is_event").notNull().default(false),

    /**
     * Off means it stays in the home's list but is not applied to new cases.
     * Homes stop offering things; deleting the row would also delete the
     * shape of a schedule somebody spent time getting right.
     */
    enabled: boolean("enabled").notNull().default(true),

    position: integer("position").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("timeline_templates_home_idx").on(
      table.funeralHomeId,
      table.position,
    ),
  ],
);

/** What an offset is measured from. See the `anchor` column. */
export const TIMELINE_ANCHORS = ["service", "opened"] as const;
export type TimelineAnchor = (typeof TIMELINE_ANCHORS)[number];

const DAY = 24 * 60;

/**
 * What a new home starts with.
 *
 * Chosen to be immediately recognisable to a director rather than
 * comprehensive: five things, each of which is a real phone call they
 * currently have to make. A home that wants something different edits this
 * list once, and a home that never looks at it still gets a working timeline.
 *
 * The wording is aimed at the family, because the family is who reads it.
 */
export const DEFAULT_TIMELINE_TEMPLATE: ReadonlyArray<{
  title: string;
  description: string | null;
  offsetMinutes: number;
  isEvent: boolean;
}> = [
  {
    title: "Photographs in for the slideshow",
    description:
      "Anything you have is welcome — old, blurry, or straight from a phone.",
    offsetMinutes: -4 * DAY,
    isEvent: false,
  },
  {
    title: "Tell us about them for the obituary",
    description:
      "Names, dates and a few sentences. We will write it up and check it with you.",
    offsetMinutes: -4 * DAY,
    isEvent: false,
  },
  {
    title: "Bring clothing to the funeral home",
    description: "Including anything they should be wearing — glasses, a ring, a watch.",
    offsetMinutes: -3 * DAY,
    isEvent: false,
  },
  {
    title: "Approve the proof for the service cards",
    description: "A last read for spellings, especially names.",
    offsetMinutes: -2 * DAY,
    isEvent: false,
  },
  {
    title: "The service",
    description: null,
    offsetMinutes: 0,
    isEvent: true,
  },
];

export const insertTimelineTemplateSchema = createInsertSchema(
  timelineTemplatesTable,
).omit({ id: true, funeralHomeId: true, createdAt: true, updatedAt: true });
export type InsertTimelineTemplate = z.infer<
  typeof insertTimelineTemplateSchema
>;
export type TimelineTemplate = typeof timelineTemplatesTable.$inferSelect;

/**
 * Where an entry falls, given both dates a case can be measured from.
 *
 * Returns null only when the anchor this entry needs does not exist yet — a
 * service-anchored step on a case with no service date. That is a real state
 * (a home opens a file the morning of a death and sets the funeral two days
 * later), and it is deliberately not faked by falling back to the other
 * anchor: a family told the wrong date is worse off than a family told
 * nothing, and the timeline simply builds itself the moment the date lands.
 */
export function dueAtFor(
  template: Pick<TimelineTemplate, "offsetMinutes"> & { anchor?: string | null },
  serviceAt: Date | null,
  openedAt?: Date | null,
): Date | null {
  const base = (template.anchor ?? "service") === "opened" ? openedAt ?? null : serviceAt;
  if (!base) return null;
  return new Date(base.getTime() + template.offsetMinutes * 60_000);
}

/** "3 days before the service", for the settings screen. */
export function describeOffset(
  offsetMinutes: number,
  anchor: string = "service",
): string {
  const from = anchor === "opened" ? " we open the file" : " the service";
  if (offsetMinutes === 0) {
    return anchor === "opened" ? "The day we open the file" : "On the day";
  }

  const before = offsetMinutes < 0;
  const total = Math.abs(offsetMinutes);
  const days = Math.floor(total / DAY);
  const hours = Math.round((total % DAY) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);

  return `${parts.join(" ") || "0 hours"} ${before ? "before" : "after"}${from}`;
}

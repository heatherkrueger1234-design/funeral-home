/**
 * The funeral-home schema, in dependency order.
 *
 * The shape to hold in your head: a `funeral_homes` row is the tenant, and
 * everything else carries `funeralHomeId` so that every query can be scoped
 * with one predicate. Below that, a `cases` row is one death, and the family
 * reaches it through a `family_contacts` token rather than an account.
 */

/* The tenant, and the people who work there. A group, where there is one,
 * sits above the tenant and carries only the contract — never a way to read
 * across it. */
export * from "./home-groups";
export * from "./funeral-homes";
export * from "./users";
export * from "./sessions";
export * from "./password-resets";

/* Bytes. */
export * from "./uploads";

/* A death, and the family's way in. */
export * from "./cases";
export * from "./family-contacts";

/* The two ways in that do not start with a director: a family who found the
 * home themselves, and someone arranging their own funeral in advance. */
export * from "./intake";

/* The asset drop. */
export * from "./photos";
export * from "./obituary";
export * from "./selections";

/* What the family brings in, and how they should look. */
export * from "./belongings";

/* The paperwork that holds everything else up. */
export * from "./vital-statistics";

/* What gets printed. */
export * from "./print";

/* Working the case together. */
export * from "./timeline-templates";
export * from "./messages";
export * from "./deadlines";
export * from "./service-offers";

/* What the home says once, and what it charges. The second of these is
 * staff-only, and `price-list.ts` explains at length why that is not a
 * preference. */
export * from "./policies";
export * from "./price-list";

/* What we charge the home, and the standing refusal to charge the family.
 * `plans.ts` is the file that argues the second one. */
export * from "./plans";

/* The local network a home can point a family at. */
export * from "./vendors";

/* After everyone goes home. */
export * from "./aftercare";

/* And what is left when a home erases a case on request. */
export * from "./deletions";

/* The platform's own view of its customers: what Colorado asks of each home,
 * and the log of every time anyone here looked across a tenant boundary. */
export * from "./licensure";
export * from "./platform-audit";

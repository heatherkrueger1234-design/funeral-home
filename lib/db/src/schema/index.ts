/**
 * The funeral-home schema, in dependency order.
 *
 * The shape to hold in your head: a `funeral_homes` row is the tenant, and
 * everything else carries `funeralHomeId` so that every query can be scoped
 * with one predicate. Below that, a `cases` row is one death, and the family
 * reaches it through a `family_contacts` token rather than an account.
 */

/* The tenant, and the people who work there. */
export * from "./funeral-homes";
export * from "./users";
export * from "./sessions";
export * from "./password-resets";

/* Bytes. */
export * from "./uploads";

/* A death, and the family's way in. */
export * from "./cases";
export * from "./family-contacts";

/* The asset drop. */
export * from "./photos";
export * from "./obituary";
export * from "./selections";

/* What the family brings in, and how they should look. */
export * from "./belongings";

/* Working the case together. */
export * from "./timeline-templates";
export * from "./messages";
export * from "./deadlines";

/* After everyone goes home. */
export * from "./aftercare";

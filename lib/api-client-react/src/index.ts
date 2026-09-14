/**
 * What this package exports.
 *
 * Orval writes one directory per OpenAPI tag under `generated/` and owns that
 * directory completely — it is cleaned and rewritten on every codegen run, so
 * nothing hand-written survives in there. This file is the hand-written half,
 * and it is the one place the tags are listed.
 *
 * **Adding a tag to `openapi.yaml` means adding one line below.** That is the
 * entire cost of the per-tag layout, and it is paid instead of everyone
 * regenerating the same ten-thousand-line file and colliding on code none of
 * them wrote. Keep the list alphabetical.
 */

export * from "./generated/aftercare/aftercare";
export * from "./generated/auth/auth";
export * from "./generated/belongings/belongings";
export * from "./generated/billing/billing";
export * from "./generated/cases/cases";
export * from "./generated/contacts/contacts";
export * from "./generated/deadlines/deadlines";
export * from "./generated/family/family";
export * from "./generated/health/health";
export * from "./generated/home/home";
export * from "./generated/intake/intake";
export * from "./generated/messages/messages";
export * from "./generated/obituary/obituary";
export * from "./generated/photos/photos";
export * from "./generated/print/print";
export * from "./generated/public/public";
export * from "./generated/selections/selections";
export * from "./generated/uploads/uploads";
export * from "./generated/vendors/vendors";
export * from "./generated/vitals/vitals";

export * from "./generated/model";

/* Hand-written: the fetch mutator, and multipart uploads the spec cannot
 * describe. Not generated, and not cleaned. */
export { setBaseUrl, setAuthTokenGetter, ApiError } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";
export * from "./uploads";

export * from "./generated/api";
export * from "./generated/types";

/*
 * Orval gives two different things the one name `<Operation>Params` when an
 * operation has a path and a query string both: the zod schema for the path,
 * in `api`, and the TypeScript type of the query string, in `types`. Two
 * `export *`s that disagree export neither, and TypeScript refuses the file
 * until it is told which is meant. It is the schema, as it is for every
 * other operation; the query string has its own as `<Operation>QueryParams`.
 * An operation that gains its first query parameter beside a path one is
 * added here.
 */
export {
  GetFamilyUploadParams,
  GetUploadParams,
  ReissueContactLinkParams,
  RevokeContactParams,
  SendContactLinkParams,
} from "./generated/api";

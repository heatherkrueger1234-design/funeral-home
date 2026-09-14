import { customFetch } from "./custom-fetch";
import type {
  CatalogueImportPreview,
  CatalogueImportResult,
  CatalogueSection,
} from "./generated/model";

/**
 * The storefront's hand-written half.
 *
 * Everything that can be generated from `openapi.yaml` now is — the hooks,
 * the models, the validators. What is left here is the three kinds of thing
 * a spec cannot describe usefully:
 *
 *  1. **Multipart.** A `FormData` body has to reach `fetch` untouched, with
 *     no content type of ours, so the browser can set its own boundary. The
 *     generated `previewCatalogueImport` and `importCatalogue` describe the
 *     same endpoints for typing; these are the ones that send the file. That
 *     is the arrangement `uploads.ts` already uses beside this file.
 *  2. **URLs rather than calls.** A price list opens in a new tab, so what
 *     the page needs is an address, not a fetcher.
 *  3. **An authenticated image.** The family surface sends its credential in
 *     a header and an `<img src>` cannot carry one.
 *
 * Plus the two label maps and the money formatter, which are ours rather
 * than the server's and would only drift if each screen kept its own.
 */

/** The three lists, by the names the Funeral Rule gives them. */
export const PRICE_LIST_KINDS = ["gpl", "cpl", "obcpl"] as const;
export type PriceListKind = (typeof PRICE_LIST_KINDS)[number];

export const PRICE_LIST_LABELS: Record<PriceListKind, string> = {
  gpl: "General Price List",
  cpl: "Casket Price List",
  obcpl: "Outer Burial Container Price List",
};

/**
 * What a section is called on screen.
 *
 * Ours, not the home's. The home names its categories; these five are the
 * Rule's own divisions and mean the same thing at every home.
 */
export const SECTION_LABELS: Record<CatalogueSection, string> = {
  services: "Services",
  caskets: "Caskets",
  outer_burial_containers: "Outer burial containers",
  merchandise: "Urns and memorial items",
  cash_advance: "Paid on your behalf",
};

/** Money, formatted once so no screen invents its own opinion about cents. */
export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/* ---------------------------------------------------------- the multipart */

export function postCatalogueImportPreviewMultipart(
  file: File,
): Promise<CatalogueImportPreview> {
  const body = new FormData();
  body.append("file", file);

  return customFetch<CatalogueImportPreview>("/api/catalogue/import/preview", {
    method: "POST",
    body,
    responseType: "json",
  });
}

export function postCatalogueImportMultipart(
  file: File,
  sections: Record<string, CatalogueSection>,
): Promise<CatalogueImportResult> {
  const body = new FormData();
  body.append("file", file);
  body.append("sections", JSON.stringify(sections));

  return customFetch<CatalogueImportResult>("/api/catalogue/import", {
    method: "POST",
    body,
    responseType: "json",
  });
}

/* --------------------------------------------------------------- the URLs */

export function priceListUrl(kind: PriceListKind): string {
  return `/api/catalogue/price-lists/${kind}/render`;
}

export function statementUrl(caseId: number): string {
  return `/api/cases/${caseId}/statement/render`;
}

export function familyPriceListUrl(kind: PriceListKind): string {
  return `/api/family/storefront/price-lists/${kind}/render`;
}

export const familyStatementUrl = "/api/family/storefront/statement/render";

/** A staff-side catalogue photograph, which travels on the session cookie. */
export function cataloguePhotoUrl(uploadId: number): string {
  return `/api/uploads/${uploadId}`;
}

/* ------------------------------------------------------------- the bytes */

/**
 * A catalogue photograph for the family, fetched rather than linked.
 *
 * The family surface authenticates with a bearer token, and an `<img src>`
 * cannot carry one — so the bytes are fetched here, where the token getter
 * applies, and handed to the page as a blob. The browser's HTTP cache still
 * does its work. The alternative, putting the token in the image URL, would
 * scatter a working credential through every referrer and proxy log for the
 * sake of saving this function.
 */
export function fetchFamilyCataloguePhoto(uploadId: number): Promise<Blob> {
  return customFetch<Blob>(`/api/family/storefront/uploads/${uploadId}`, {
    responseType: "blob",
  });
}

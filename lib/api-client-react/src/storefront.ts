import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

/**
 * The storefront's client, hand-written.
 *
 * TODO(C1): every path here belongs in `lib/api-spec/paths/catalogue.yaml`
 * and `orders.yaml`, and these functions are what orval will generate from
 * them. The spec has not been split into per-domain files yet and nobody may
 * add paths to the single `openapi.yaml` until it has, so the storefront was
 * built behind it — as `uploads.ts` beside this file already is, for a
 * different reason. Deleting this file and importing the generated hooks
 * should be a rename, not a rewrite: the shapes below are the shapes the
 * server sends.
 */

export type ItemAvailability = "available" | "by_request";

export type CatalogueSection =
  | "services"
  | "caskets"
  | "outer_burial_containers"
  | "merchandise"
  | "cash_advance";

export type CatalogueItem = {
  id: number;
  categoryId: number;
  name: string;
  description: string | null;
  itemCode: string | null;
  priceCents: number;
  priceUnit: string | null;
  photoUploadId: number | null;
  availability: ItemAvailability;
  position: number;
  archivedAt: string | null;
};

export type CatalogueCategory = {
  id: number;
  name: string;
  description: string | null;
  section: CatalogueSection;
  position: number;
  archivedAt: string | null;
  items: CatalogueItem[];
};

export type CataloguePackage = {
  id: number;
  name: string;
  description: string | null;
  priceCents: number;
  /** What the same items come to bought one at a time. Always shown too. */
  itemisedTotalCents: number;
  items: CatalogueItem[];
};

export type SelectionLine = {
  id: number;
  kind: "item" | "family_provided" | "package_adjustment";
  catalogueItemId: number | null;
  packageId: number | null;
  name: string;
  description: string | null;
  section: string | null;
  /** Null on a family-provided line. There is no fee on that path. */
  unitPriceCents: number | null;
  quantity: number;
  lineTotalCents: number;
  notes: string | null;
  position: number;
};

export type Selection = {
  id: number;
  status: "draft" | "confirmed";
  gplShownAt: string | null;
  gplEffectiveOn: string | null;
  confirmedAt: string | null;
  settledAt: string | null;
  settledNote: string | null;
  notes: string | null;
  lines: SelectionLine[];
  totalCents: number;
  updatedAt: string;
};

/**
 * Where the family is told to send the money, which is never to us.
 *
 * Null on a pre-need plan and null on a draft. There is no amount in this
 * shape and never will be: we process nothing, so we know nothing, and a
 * field called `amountPaid` would be a lie with a type annotation.
 */
export type PaymentHandoff = {
  url: string | null;
  host: string | null;
  instructions: string | null;
  phone: string | null;
};

export type StorefrontPayload = {
  hasGeneralPriceList: boolean;
  gplEffectiveOn: string | null;
  casketsUnlocked: boolean;
  categories: CatalogueCategory[];
  packages: CataloguePackage[];
  selection: Selection;
  payment: PaymentHandoff | null;
  mayDiscussPayment: boolean;
};

export type DisclosureSlot = { key: string; title: string; note: string };

export type StorefrontSettings = {
  gplEffectiveOn: string | null;
  hasGeneralPriceList: boolean;
  disclosures: Record<string, string>;
  priceListFootnote: string | null;
  paymentPageUrl: string | null;
  paymentInstructions: string | null;
  disclosureSlots: DisclosureSlot[];
};

export type Catalogue = {
  hasGeneralPriceList: boolean;
  gplEffectiveOn: string | null;
  categories: CatalogueCategory[];
  packages: CataloguePackage[];
};

export type CatalogueImportPreview = {
  headers: string[];
  mapping: Record<string, string | null>;
  totalRows: number;
  categories: { name: string; section: CatalogueSection; itemCount: number }[];
  wouldCreate: number;
  wouldUpdate: number;
  rows: {
    row: number;
    categoryName: string;
    name: string;
    description: string | null;
    priceCents: number;
    itemCode: string | null;
  }[];
  issues: { row: number; message: string }[];
};

export type CatalogueImportResult = {
  created: number;
  updated: number;
  issues: { row: number; message: string }[];
};

/** The price lists, by the names the Funeral Rule gives them. */
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

/* ------------------------------------------------------------- director -- */

export const catalogueQueryKey = ["catalogue"] as const;
export const storefrontSettingsQueryKey = ["storefront", "settings"] as const;
export const caseSelectionQueryKey = (caseId: number) =>
  ["cases", caseId, "selection"] as const;

const json = (body: unknown): RequestInit => ({
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

export function useCatalogue(
  options?: Partial<UseQueryOptions<Catalogue>>,
) {
  return useQuery<Catalogue>({
    queryKey: catalogueQueryKey,
    queryFn: () => customFetch<Catalogue>("/api/catalogue", { responseType: "json" }),
    ...options,
  });
}

export function useStorefrontSettings(
  options?: Partial<UseQueryOptions<StorefrontSettings>>,
) {
  return useQuery<StorefrontSettings>({
    queryKey: storefrontSettingsQueryKey,
    queryFn: () =>
      customFetch<StorefrontSettings>("/api/storefront/settings", {
        responseType: "json",
      }),
    ...options,
  });
}

export function saveStorefrontSettings(
  values: Partial<{
    gplEffectiveOn: string | null;
    disclosures: Record<string, string>;
    priceListFootnote: string | null;
    paymentPageUrl: string | null;
    paymentInstructions: string | null;
  }>,
): Promise<StorefrontSettings> {
  return customFetch<StorefrontSettings>("/api/storefront/settings", {
    method: "PUT",
    responseType: "json",
    ...json(values),
  });
}

export function createCategory(values: {
  name: string;
  description?: string | null;
  section: CatalogueSection;
}): Promise<CatalogueCategory> {
  return customFetch<CatalogueCategory>("/api/catalogue/categories", {
    method: "POST",
    responseType: "json",
    ...json(values),
  });
}

export function updateCategory(
  categoryId: number,
  values: Partial<{
    name: string;
    description: string | null;
    section: CatalogueSection;
    archived: boolean;
  }>,
): Promise<CatalogueCategory> {
  return customFetch<CatalogueCategory>(`/api/catalogue/categories/${categoryId}`, {
    method: "PUT",
    responseType: "json",
    ...json(values),
  });
}

export function deleteCategory(categoryId: number): Promise<unknown> {
  return customFetch(`/api/catalogue/categories/${categoryId}`, {
    method: "DELETE",
  });
}

export function createItem(values: {
  categoryId: number;
  name: string;
  description?: string | null;
  itemCode?: string | null;
  priceCents: number;
  priceUnit?: string | null;
  photoUploadId?: number | null;
  availability?: ItemAvailability;
}): Promise<CatalogueItem> {
  return customFetch<CatalogueItem>("/api/catalogue/items", {
    method: "POST",
    responseType: "json",
    ...json(values),
  });
}

export function updateItem(
  itemId: number,
  values: Partial<{
    categoryId: number;
    name: string;
    description: string | null;
    itemCode: string | null;
    priceCents: number;
    priceUnit: string | null;
    photoUploadId: number | null;
    availability: ItemAvailability;
    archived: boolean;
  }>,
): Promise<CatalogueItem> {
  return customFetch<CatalogueItem>(`/api/catalogue/items/${itemId}`, {
    method: "PUT",
    responseType: "json",
    ...json(values),
  });
}

export function deleteItem(itemId: number): Promise<unknown> {
  return customFetch(`/api/catalogue/items/${itemId}`, { method: "DELETE" });
}

export function createPackage(values: {
  name: string;
  description?: string | null;
  priceCents: number;
  itemIds: number[];
}): Promise<CataloguePackage> {
  return customFetch<CataloguePackage>("/api/catalogue/packages", {
    method: "POST",
    responseType: "json",
    ...json(values),
  });
}

export function deletePackage(packageId: number): Promise<unknown> {
  return customFetch(`/api/catalogue/packages/${packageId}`, {
    method: "DELETE",
  });
}

/**
 * The spreadsheet, in two steps.
 *
 * Multipart, so it is hand-written here for the same reason the photograph
 * uploads beside it are: a `FormData` body has to reach `fetch` with no
 * content type of ours, so the browser can set its own boundary.
 */
export function previewCatalogueImport(
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

export function runCatalogueImport(
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

export function priceListUrl(kind: PriceListKind): string {
  return `/api/catalogue/price-lists/${kind}/render`;
}

/* ------------------------------------------- the selection, staff-side -- */

export function useCaseSelection(
  caseId: number,
  options?: Partial<UseQueryOptions<StorefrontPayload>>,
) {
  return useQuery<StorefrontPayload>({
    queryKey: caseSelectionQueryKey(caseId),
    queryFn: () =>
      customFetch<StorefrontPayload>(`/api/cases/${caseId}/selection`, {
        responseType: "json",
      }),
    ...options,
  });
}

export function recordGplGiven(caseId: number): Promise<Selection> {
  return customFetch<Selection>(`/api/cases/${caseId}/selection/gpl-given`, {
    method: "POST",
    responseType: "json",
  });
}

export function addCaseSelectionItem(
  caseId: number,
  values: { itemId: number; quantity?: number },
): Promise<Selection> {
  return customFetch<Selection>(`/api/cases/${caseId}/selection/items`, {
    method: "POST",
    responseType: "json",
    ...json(values),
  });
}

export function addCaseSelectionPackage(
  caseId: number,
  packageId: number,
): Promise<Selection> {
  return customFetch<Selection>(`/api/cases/${caseId}/selection/packages`, {
    method: "POST",
    responseType: "json",
    ...json({ packageId }),
  });
}

export function addCaseFamilyProvided(
  caseId: number,
  values: { name: string; notes?: string | null },
): Promise<Selection> {
  return customFetch<Selection>(`/api/cases/${caseId}/selection/family-provided`, {
    method: "POST",
    responseType: "json",
    ...json(values),
  });
}

export function updateCaseSelectionLine(
  caseId: number,
  lineId: number,
  values: { quantity?: number; notes?: string | null },
): Promise<Selection> {
  return customFetch<Selection>(`/api/cases/${caseId}/selection/items/${lineId}`, {
    method: "PUT",
    responseType: "json",
    ...json(values),
  });
}

export function removeCaseSelectionLine(
  caseId: number,
  lineId: number,
): Promise<Selection> {
  return customFetch<Selection>(`/api/cases/${caseId}/selection/items/${lineId}`, {
    method: "DELETE",
    responseType: "json",
  });
}

export function updateCaseSelection(
  caseId: number,
  values: Partial<{
    notes: string | null;
    confirmed: boolean;
    settled: boolean;
    settledNote: string | null;
  }>,
): Promise<StorefrontPayload> {
  return customFetch<StorefrontPayload>(`/api/cases/${caseId}/selection`, {
    method: "PUT",
    responseType: "json",
    ...json(values),
  });
}

export function statementUrl(caseId: number): string {
  return `/api/cases/${caseId}/statement/render`;
}

/* --------------------------------------------------------------- family -- */

export const familyStorefrontQueryKey = ["family", "storefront"] as const;

export function useFamilyStorefront(
  options?: Partial<UseQueryOptions<StorefrontPayload>>,
) {
  return useQuery<StorefrontPayload>({
    queryKey: familyStorefrontQueryKey,
    queryFn: () =>
      customFetch<StorefrontPayload>("/api/family/storefront", {
        responseType: "json",
      }),
    ...options,
  });
}

export function addFamilySelectionItem(values: {
  itemId: number;
  quantity?: number;
}): Promise<Selection> {
  return customFetch<Selection>("/api/family/storefront/items", {
    method: "POST",
    responseType: "json",
    ...json(values),
  });
}

export function addFamilySelectionPackage(packageId: number): Promise<Selection> {
  return customFetch<Selection>("/api/family/storefront/packages", {
    method: "POST",
    responseType: "json",
    ...json({ packageId }),
  });
}

/**
 * "We are bringing our own."
 *
 * A name and, if they like, a note. No price is sent because none is
 * accepted: a funeral provider may not charge a handling fee for a casket
 * or urn a family bought elsewhere, and there is nowhere in this product
 * for such a fee to go.
 */
export function addFamilyProvided(values: {
  name: string;
  notes?: string | null;
}): Promise<Selection> {
  return customFetch<Selection>("/api/family/storefront/family-provided", {
    method: "POST",
    responseType: "json",
    ...json(values),
  });
}

export function removeFamilySelectionLine(lineId: number): Promise<Selection> {
  return customFetch<Selection>(`/api/family/storefront/items/${lineId}`, {
    method: "DELETE",
    responseType: "json",
  });
}

export function updateFamilySelectionLine(
  lineId: number,
  values: { quantity?: number; notes?: string | null },
): Promise<Selection> {
  return customFetch<Selection>(`/api/family/storefront/items/${lineId}`, {
    method: "PUT",
    responseType: "json",
    ...json(values),
  });
}

export function familyPriceListUrl(kind: PriceListKind): string {
  return `/api/family/storefront/price-lists/${kind}/render`;
}

export const familyStatementUrl = "/api/family/storefront/statement/render";

/**
 * A catalogue photograph, fetched rather than linked.
 *
 * The family surface authenticates with a bearer token, and an `<img src>`
 * cannot carry one — so the bytes are fetched here, where the token getter
 * applies, and handed to the page as a blob. The browser's HTTP cache still
 * does its work, and the alternative, putting the token in the image URL,
 * would scatter a working credential through every referrer and proxy log
 * for the sake of saving this function.
 */
export function fetchFamilyCataloguePhoto(uploadId: number): Promise<Blob> {
  return customFetch<Blob>(`/api/family/storefront/uploads/${uploadId}`, {
    responseType: "blob",
  });
}

export function cataloguePhotoUrl(uploadId: number): string {
  return `/api/uploads/${uploadId}`;
}

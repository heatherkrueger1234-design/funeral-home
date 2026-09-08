import { logger } from "./logger";
import { milesBetween } from "@workspace/db";
import type { Located } from "./vendors";

/**
 * Looking up real businesses, live.
 *
 * There is no public-domain nationwide directory of monument companies,
 * casket dealers or celebrants — those are licensed commercial products — and
 * seeding invented ones into a tool that hands them to bereaved families is
 * not a shortcut worth taking. A plausible name and number that nobody
 * answers, or worse that somebody unrelated answers, is a real harm done to
 * somebody having the worst week of their life.
 *
 * So the directory starts empty and this exists to fill it honestly: the home
 * connects a provider with its own key, searches, and saves the results it
 * recognises. Real names, real numbers, from a source that maintains them.
 *
 * Google Places is the first provider because its coverage is the broadest,
 * but nothing above this file knows that — `lookupPlaces` returns a neutral
 * shape, so a home using a different provider is a new function here rather
 * than a change to the routes or the console.
 */

export type PlaceCandidate = {
  sourceRef: string;
  name: string;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  distanceMiles: number | null;
};

export type LookupResult = {
  configured: boolean;
  provider: string | null;
  results: PlaceCandidate[];
  message: string | null;
};

/** What to actually search for, per category. */
const SEARCH_TERMS: Record<string, string> = {
  monument: "headstone and monument company",
  cemetery: "cemetery",
  casket: "casket store",
  urn: "cremation urn store",
  clergy: "church",
  celebrant: "funeral celebrant",
  florist: "florist",
  musician: "funeral musician",
  caterer: "caterer",
  transport: "limousine service",
  other: "funeral services",
};

function apiKey(): string | null {
  return process.env["GOOGLE_PLACES_API_KEY"] || null;
}

export function isPlacesConfigured(): boolean {
  return apiKey() !== null;
}

type PlacesResponse = {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    nationalPhoneNumber?: string;
    websiteUri?: string;
    shortFormattedAddress?: string;
    addressComponents?: Array<{
      longText?: string;
      shortText?: string;
      types?: string[];
    }>;
    location?: { latitude?: number; longitude?: number };
  }>;
  error?: { message?: string };
};

function component(
  place: NonNullable<PlacesResponse["places"]>[number],
  type: string,
  short = false,
): string | null {
  const found = place.addressComponents?.find((c) => c.types?.includes(type));
  return (short ? found?.shortText : found?.longText) ?? null;
}

export async function lookupPlaces(options: {
  kind: string;
  from: Located;
  radiusMiles: number;
}): Promise<LookupResult> {
  const key = apiKey();

  if (!key) {
    // Not an error. A home that has not connected a provider has simply not
    // connected one, and saying "no results" would be a lie.
    return {
      configured: false,
      provider: null,
      results: [],
      message:
        "No lookup provider is connected. Add vendors by hand, or ask your administrator to connect one.",
    };
  }

  const metres = Math.min(50_000, Math.round(options.radiusMiles * 1609.34));

  try {
    const response = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          // Field mask is required, and keeping it tight is what keeps the
          // per-request cost at the cheapest tier.
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.nationalPhoneNumber,places.websiteUri,places.shortFormattedAddress,places.addressComponents,places.location",
        },
        body: JSON.stringify({
          textQuery: SEARCH_TERMS[options.kind] ?? SEARCH_TERMS["other"],
          maxResultCount: 20,
          locationBias: {
            circle: {
              center: {
                latitude: options.from.latitude,
                longitude: options.from.longitude,
              },
              radius: metres,
            },
          },
        }),
      },
    );

    const body = (await response.json()) as PlacesResponse;

    if (!response.ok) {
      logger.error(
        { status: response.status, detail: body.error?.message },
        "Places lookup failed",
      );
      return {
        configured: true,
        provider: "google",
        results: [],
        message: body.error?.message ?? "The lookup service refused that request.",
      };
    }

    const results: PlaceCandidate[] = (body.places ?? [])
      .filter((place) => place.id && place.displayName?.text)
      .map((place) => {
        const lat = place.location?.latitude;
        const lon = place.location?.longitude;

        return {
          sourceRef: place.id!,
          name: place.displayName!.text!,
          phone: place.nationalPhoneNumber ?? null,
          website: place.websiteUri ?? null,
          addressLine1:
            [component(place, "street_number"), component(place, "route")]
              .filter(Boolean)
              .join(" ") ||
            place.shortFormattedAddress ||
            null,
          city: component(place, "locality"),
          region: component(place, "administrative_area_level_1", true),
          postalCode: component(place, "postal_code"),
          distanceMiles:
            lat !== undefined && lon !== undefined
              ? Math.round(
                  milesBetween(options.from, {
                    latitude: lat,
                    longitude: lon,
                  }) * 10,
                ) / 10
              : null,
        };
      });

    results.sort(
      (a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity),
    );

    return { configured: true, provider: "google", results, message: null };
  } catch (err) {
    logger.error({ err }, "Places lookup threw");
    return {
      configured: true,
      provider: "google",
      results: [],
      message: "Could not reach the lookup service just now.",
    };
  }
}

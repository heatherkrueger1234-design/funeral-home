import { customFetch } from "./custom-fetch";

/**
 * The multipart endpoints, hand-written.
 *
 * Orval generates JSON callers, and a `FormData` body has to reach `fetch`
 * untouched — in particular with no `Content-Type` header, so the browser can
 * set its own multipart boundary. The generated `uploadFile` and
 * `uploadFamilyPhoto` describe the same endpoints for typing purposes; these
 * are the ones that actually send a file.
 */

export type UploadedFile = {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

/** Kept in step with the server's own limit and sniffer. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * What the file picker offers.
 *
 * HEIC is listed explicitly because iPhones shoot it by default and some
 * browsers will otherwise grey out exactly the photographs a family is trying
 * to send. The server transcodes it to JPEG on arrival.
 */
export const ACCEPTED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
] as const;

/**
 * The `accept` of every photograph picker, in both apps.
 *
 * The extensions as well as the types, because some Android pickers report
 * an iPhone's HEIC with no type at all and would otherwise grey out exactly
 * the photographs somebody's sister sent them. The family portal said so
 * and the console's picker did not, so it is said once, here.
 */
export const PHOTO_PICKER_ACCEPT = [...ACCEPTED_UPLOAD_TYPES, ".heic", ".heif"].join(",");

/** Staff upload: the home's logo, or a photograph posted to the office. */
export async function postUploadMultipart(file: File): Promise<UploadedFile> {
  const body = new FormData();
  body.append("file", file);

  return customFetch<UploadedFile>("/api/uploads", {
    method: "POST",
    body,
    responseType: "json",
  });
}

/**
 * Staff adding a photograph to one case's bin: the print posted to the
 * office. Goes to the case, not to `/uploads`, so it reaches the bin, the
 * pack and the slideshow.
 */
export async function postCasePhotoMultipart(
  caseId: number,
  file: File,
  caption?: string,
): Promise<unknown> {
  const body = new FormData();
  body.append("file", file);
  if (caption?.trim()) body.append("caption", caption.trim());

  return customFetch<unknown>(`/api/cases/${caseId}/photos`, {
    method: "POST",
    body,
    responseType: "json",
  });
}

/**
 * A family adding a photograph to the bin. Authenticated by the link token,
 * which `customFetch` attaches as a bearer header from the configured getter.
 */
export async function postFamilyPhotoMultipart(
  file: File,
  caption?: string,
): Promise<unknown> {
  const body = new FormData();
  body.append("file", file);
  if (caption?.trim()) body.append("caption", caption.trim());

  return customFetch<unknown>("/api/family/photos", {
    method: "POST",
    body,
    responseType: "json",
  });
}

/**
 * How long a "not yet" (a 429) asked to be given, in milliseconds: its
 * Retry-After, kept between a second and a minute, or ten seconds when it
 * named none. Null for any other answer, which waiting will not change.
 */
export function waitAsked(error: unknown): number | null {
  if ((error as { status?: number } | null)?.status !== 429) return null;
  const header = (error as { headers?: Headers }).headers?.get("retry-after");
  return Math.min(60, Math.max(1, Number(header) || 10)) * 1000;
}

/**
 * Send, and when the server says "not yet" (a 429), wait as long as it says
 * and send the same thing again -- up to four more times.
 *
 * Two different "not yet"s arrive here, and in neither was anything wrong
 * with the photograph. A family's link has a per-minute ceiling that a
 * family choosing three hundred pictures on good wifi can reach; and the API
 * holds only so many uploads in memory at once, which anybody can meet in a
 * busy minute. Each used to come back as its own "Couldn't add", seventy of
 * them for photographs that were perfectly fine.
 */
export async function withPatience<T>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      const wait = waitAsked(error);
      if (wait === null || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

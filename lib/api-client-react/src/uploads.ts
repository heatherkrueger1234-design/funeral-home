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
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const ACCEPTED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

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

import { customFetch } from "./custom-fetch";

export type UploadedFile = {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  /** Path to fetch the file from while signed in. */
  url: string;
};

/** Kept in step with the server's own limits and sniffer. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Audio is allowed more room; a song is bigger than a photograph. */
export const MAX_AUDIO_BYTES = 40 * 1024 * 1024;

export const ACCEPTED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const;

export const ACCEPTED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "audio/flac",
] as const;

/**
 * Hand-written rather than generated: this is the one multipart endpoint, and
 * a FormData body must reach fetch untouched — in particular without a
 * Content-Type header, so the browser can set its own multipart boundary.
 */
export async function uploadFile(file: File): Promise<UploadedFile> {
  const body = new FormData();
  body.append("file", file);

  return customFetch<UploadedFile>("/api/uploads", {
    method: "POST",
    body,
    responseType: "json",
  });
}

export async function deleteUpload(id: number): Promise<void> {
  await customFetch<void>(`/api/uploads/${id}`, { method: "DELETE" });
}

export type UploadUsage = {
  usedBytes: number;
  limitBytes: number;
};

/** How much of this account's file allowance is already spent. */
export async function getUploadUsage(): Promise<UploadUsage> {
  return customFetch<UploadUsage>("/api/uploads/usage", {
    method: "GET",
    responseType: "json",
  });
}

/** Stable key so the account page and any future caller share one cache entry. */
export const uploadUsageQueryKey = ["/api/uploads/usage"] as const;

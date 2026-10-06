import { getGetUploadUrl } from "@workspace/api-client-react";

/**
 * How large a stored photograph is drawn, which decides what is fetched.
 *
 * `thumb`: small -- a row, a picker, anything up to about a hundred pixels.
 * The server's thumbnail, about 320 across, sharp at that size on any
 * screen. `card`: the bin's cards, about 300 pixels wide. The thumbnail
 * where a screen has one pixel to each, the photograph itself where it has
 * two or more, because the cards are where a director decides what is sharp
 * enough to project, and a thumbnail stretched across a Retina screen makes
 * every photograph look soft. `full`: the photograph itself.
 */
export type PhotoSize = "thumb" | "card" | "full";

export function photoSources(
  uploadId: number,
  size: PhotoSize,
): { src: string; srcSet?: string } {
  const full = getGetUploadUrl(uploadId);
  if (size === "full") return { src: full };

  const thumb = getGetUploadUrl(uploadId, { size: "thumb" });
  if (size === "thumb") return { src: thumb };
  return { src: thumb, srcSet: `${thumb} 1x, ${full} 2x` };
}

/**
 * How long to wait before asking again for a photograph that did not
 * arrive, after this many failures; null to stop asking.
 *
 * The server makes only so many thumbnails at once and answers the rest
 * "not yet" (429), which an <img> can only report as an error, the same as
 * any other. So every error is asked about again, later each time, four
 * times over half a minute: the first after the two seconds the server
 * asks for, the last long after a crowd of them has been made.
 */
export function waitAfterFailure(failures: number): number | null {
  if (failures < 1 || failures > 4) return null;
  return 1000 * 2 ** failures;
}

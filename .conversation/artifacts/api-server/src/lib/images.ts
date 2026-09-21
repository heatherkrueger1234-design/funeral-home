import sharp from "sharp";
import { logger } from "./logger";
import { badRequest } from "./http";

/**
 * Normalising what comes off a phone.
 *
 * Two things were quietly breaking the most important flow in the product.
 *
 * **HEIC.** iPhones shoot it by default. Refusing it means a family uploading
 * their mother's photographs watches half of them fail; storing it means
 * Chrome and Firefox render a broken image, because neither decodes HEIC.
 * Either way the family concludes the tool is broken and goes back to
 * emailing the director forty attachments. So HEIC and AVIF are decoded and
 * re-encoded as JPEG on the way in, and everything downstream — the browser,
 * the slideshow pack, the printer — sees a format that has worked everywhere
 * for thirty years.
 *
 * **Size.** A modern phone photograph is 12 megapixels and 4-6 MB; a DSLR
 * scan can be 60 MB. Fifty of those is a slideshow nobody can load over
 * hotel wifi and a database backup nobody wants to restore. Anything larger
 * than the long edge below is downscaled.
 *
 * What is deliberately *not* done: cropping, rotating away the original, or
 * stripping the image down to the crop the family chose. The stored file
 * stays the whole photograph, because the crop is instructions (see the
 * `case_photos` comment) and a print shop asking for the full-resolution
 * original should get one.
 */

/** Long edge. Comfortably above what any projector or print card needs. */
const MAX_EDGE = 3000;

/** Re-encode quality. 82 is the point where the next percent costs real size. */
const JPEG_QUALITY = 82;

export type NormalisedImage = {
  data: Buffer;
  mimeType: string;
  /** True when the bytes were re-encoded rather than passed through. */
  converted: boolean;
};

const NEEDS_TRANSCODE = new Set(["image/heic", "image/avif"]);

export async function normaliseImage(
  data: Buffer,
  mimeType: string,
): Promise<NormalisedImage> {
  // GIFs are left completely alone: they are almost always a short animation
  // somebody meant to keep, and re-encoding one to JPEG silently destroys it.
  if (mimeType === "image/gif") {
    return { data, mimeType, converted: false };
  }

  let image: sharp.Sharp;
  let meta: sharp.Metadata;

  try {
    image = sharp(data, { failOn: "none" });
    meta = await image.metadata();
  } catch (err) {
    logger.warn({ err, mimeType }, "Could not read an uploaded image");
    throw badRequest(
      "That photograph could not be read. It may be damaged — try sending it again, or a different copy.",
    );
  }

  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  const mustTranscode = NEEDS_TRANSCODE.has(mimeType);
  const mustShrink = longEdge > MAX_EDGE;

  if (!mustTranscode && !mustShrink) {
    return { data, mimeType, converted: false };
  }

  // HEIC first, through whichever decoder can actually read it.
  const source = mustTranscode ? await decodeHeic(data, mimeType) : image;

  try {
    const pipeline = source
      // Phones record orientation in EXIF rather than in the pixels. Without
      // this, a photograph taken in portrait arrives on its side — which is
      // exactly the sort of small wrongness that makes a family think the
      // tool mangled their picture. (A no-op on the raw-RGBA fallback path,
      // where libheif has already applied it.)
      .rotate()
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      });

    // HEIC goes to JPEG. An oversized JPEG or PNG keeps its own format, so a
    // PNG with transparency does not silently gain a black background.
    const output =
      mustTranscode || mimeType === "image/jpeg"
        ? await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
        : mimeType === "image/png"
          ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
          : await pipeline.webp({ quality: JPEG_QUALITY }).toBuffer();

    return {
      data: output,
      mimeType: mustTranscode ? "image/jpeg" : mimeType,
      converted: true,
    };
  } catch (err) {
    logger.error({ err, mimeType }, "Image conversion failed");

    // A conversion failure on a format the browser can already display is
    // not worth losing the upload over.
    if (!mustTranscode) {
      return { data, mimeType, converted: false };
    }

    throw badRequest(
      "That photograph is in a format we couldn't convert. Sending it from your phone's Photos app usually fixes it.",
    );
  }
}

/**
 * Decode HEIC, the hard way when necessary.
 *
 * libvips can parse the HEIF container but many builds ship without an HEVC
 * decoder, because HEVC is patent-encumbered and distributions leave it out.
 * On those builds sharp reads the metadata happily and then fails part-way
 * through the pixels -- which is the worst failure mode available, since it
 * looks like support right up until a real iPhone photograph arrives.
 *
 * So: try sharp, and on failure fall back to a WebAssembly libheif that
 * carries its own HEVC decoder. Slower and heavier, and it means the feature
 * works the same on every machine rather than depending on how somebody built
 * libvips. The fallback is only ever reached for HEIC.
 */
async function decodeHeic(data: Buffer, mimeType: string): Promise<sharp.Sharp> {
  try {
    // Force the pixels now rather than at encode time, so a broken decoder
    // fails here where it can be handled instead of half-way through output.
    const probe = sharp(data, { failOn: "none" });
    await probe.clone().raw().toBuffer();
    return probe;
  } catch (err) {
    logger.info(
      { mimeType },
      "libvips could not decode this HEIC; falling back to the bundled decoder",
    );

    const { default: decode } = await import("heic-decode");

    const { width, height, data: rgba } = await decode({
      buffer: new Uint8Array(data),
    });

    return sharp(Buffer.from(rgba), {
      raw: { width, height, channels: 4 },
    });
  }
}

/** A readable filename once the bytes are no longer what the name claims. */
export function renameForType(filename: string, mimeType: string): string {
  if (mimeType !== "image/jpeg") return filename;
  return filename.replace(/\.(heic|heif|avif)$/i, ".jpg");
}

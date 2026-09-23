import sharp, { type Metadata, type Sharp } from "sharp";
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

  let image: Sharp;
  let meta: Metadata;

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
  /*
   * Every phone writes where a photograph was taken into the file, and the
   * photograph a family sends of their mother in her garden is taken at her
   * house. Passed through, those coordinates went on into the photo pack, the
   * slideshow files a home hands to a video company, and the printed book. A
   * re-encode drops them (sharp keeps no metadata unless asked to), so a file
   * that carries any is re-encoded even when it is small enough to keep. A
   * photograph that carries none still arrives byte for byte.
   */
  const mustStrip = Boolean(meta.exif || meta.xmp || meta.iptc);

  /*
   * The common case -- an upright JPEG under the size ceiling -- loses its
   * metadata without being re-encoded: the segments that carry it are cut out
   * and every pixel is the family's own. Only a photograph whose orientation
   * tag still has work to do is re-encoded, because cutting the tag out of
   * that one would turn it on its side.
   */
  if (
    mustStrip &&
    !mustTranscode &&
    !mustShrink &&
    mimeType === "image/jpeg" &&
    (meta.orientation ?? 1) === 1
  ) {
    const stripped = stripJpegMetadata(data);
    if (stripped) {
      return { data: stripped, mimeType, converted: true };
    }
  }

  if (!mustTranscode && !mustShrink && !mustStrip) {
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
    // not worth losing the upload over -- unless keeping it would keep the
    // location it was taken at.
    if (!mustTranscode && !mustStrip) {
      return { data, mimeType, converted: false };
    }

    throw badRequest(
      "That photograph is in a format we couldn't convert. Sending it from your phone's Photos app usually fixes it.",
    );
  }
}

/**
 * Cut EXIF, XMP and IPTC out of a JPEG without touching the image data.
 *
 * A JPEG is a run of marker segments before the compressed scan. EXIF and XMP
 * live in APP1 (0xFFE1) and IPTC in APP13 (0xFFED); dropping those segments
 * and copying everything else -- including the scan, byte for byte -- leaves
 * the same picture with nothing in it that says where it was taken. ICC
 * colour profiles (APP2) stay, because without one a photograph from a
 * wide-gamut phone comes out dull.
 *
 * Returns null for anything it does not fully understand, and the caller
 * re-encodes instead: a half-parsed file is not a file to store.
 */
export function stripJpegMetadata(data: Buffer): Buffer | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;

  const kept: Buffer[] = [data.subarray(0, 2)];
  let offset = 2;

  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) return null;
    const marker = data[offset + 1]!;

    // Start of scan: from here on it is the compressed image, which is kept whole.
    if (marker === 0xda) {
      kept.push(data.subarray(offset));
      return Buffer.concat(kept);
    }
    // Fill bytes and standalone markers carry no length.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }

    const length = data.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > data.length) return null;

    if (marker !== 0xe1 && marker !== 0xed) {
      kept.push(data.subarray(offset, offset + 2 + length));
    }
    offset += 2 + length;
  }

  return null;
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
async function decodeHeic(data: Buffer, mimeType: string): Promise<Sharp> {
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

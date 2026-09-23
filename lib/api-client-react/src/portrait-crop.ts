/**
 * The portrait crop, as both apps draw it.
 *
 * A crop is stored as instructions -- `cropX`, `cropY`, `cropWidth` and
 * `cropHeight`, fractions (0..1) of the original photograph -- and never
 * applied to the bytes, so a face cropped badly at midnight can be put right
 * in the morning and a print shop can still be handed the whole original.
 * That means every screen that shows the portrait has to apply the same
 * instructions the same way, or the family frames their father's face on
 * the phone and the director sees his shoulder. So the arithmetic lives here,
 * once, beside the generated client both frontends already import; the print
 * renderer on the server cuts the same rectangle out with sharp and lets the
 * card's frame cover it, which is exactly what `visibleRect` does below.
 *
 * Coordinates are in the photograph as it is *displayed* -- with any EXIF
 * rotation applied -- because that is the picture the family was looking at
 * when they chose, and it is what both a browser `<img>` and sharp's
 * `.rotate()` produce.
 */

/** Width over height of the portrait frame: the 4:5 of the printed cards. */
export const PORTRAIT_ASPECT = 4 / 5;

/** How far in the family can zoom. Past this a phone photo is mush. */
export const MAX_PORTRAIT_ZOOM = 4;

export type Crop = { x: number; y: number; width: number; height: number };

type CropFields = {
  cropX: number | null;
  cropY: number | null;
  cropWidth: number | null;
  cropHeight: number | null;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The stored instructions, or null when there is no (usable) crop. */
export function cropOf(photo: CropFields): Crop | null {
  const { cropX, cropY, cropWidth, cropHeight } = photo;
  if (cropX === null || cropY === null || cropWidth === null || cropHeight === null) {
    return null;
  }
  if (!(cropWidth > 0) || !(cropHeight > 0)) return null;
  return { x: cropX, y: cropY, width: cropWidth, height: cropHeight };
}

/**
 * The largest rectangle of the frame's shape that fits the photograph,
 * centred. What an uncropped photograph shows, and zoom 1 in the editor.
 */
export function coverCrop(imageAspect: number, frameAspect = PORTRAIT_ASPECT): Crop {
  if (imageAspect > frameAspect) {
    const width = frameAspect / imageAspect;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = imageAspect / frameAspect;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

/**
 * What of the photograph a frame of `frameAspect` shows for a stored crop.
 *
 * The crop covers the frame, centred, the way `object-fit: cover` covers a
 * box: a 4:5 crop in a 4:5 card is shown exactly, and the same crop in the
 * square register page loses a sliver top and bottom rather than being
 * squashed. No crop at all is the centred cover of the whole photograph.
 */
export function visibleRect(
  crop: Crop | null,
  imageAspect: number,
  frameAspect = PORTRAIT_ASPECT,
): Crop {
  if (!crop) return coverCrop(imageAspect, frameAspect);

  const cropAspect = (crop.width / crop.height) * imageAspect;
  if (cropAspect > frameAspect) {
    const width = (crop.height * frameAspect) / imageAspect;
    return { ...crop, x: crop.x + (crop.width - width) / 2, width };
  }
  const height = (crop.width * imageAspect) / frameAspect;
  return { ...crop, y: crop.y + (crop.height - height) / 2, height };
}

/**
 * Style for an `<img>` inside a positioned, overflow-hidden frame, so that
 * exactly `rect` of it fills the frame. Everything is a percentage of the
 * frame, so the same style is right at any size the frame is drawn.
 */
export function cropImageStyle(rect: Crop): {
  position: "absolute";
  width: string;
  height: string;
  left: string;
  top: string;
  maxWidth: "none";
} {
  return {
    position: "absolute",
    width: `${100 / rect.width}%`,
    height: `${100 / rect.height}%`,
    left: `${(-rect.x / rect.width) * 100}%`,
    top: `${(-rect.y / rect.height) * 100}%`,
    maxWidth: "none",
  };
}

/* ------------------------------------------------------------ the editor -- */

/** Keep a rectangle inside the photograph without changing its size. */
export function clampCrop(crop: Crop): Crop {
  const width = Math.min(1, Math.max(0, crop.width));
  const height = Math.min(1, Math.max(0, crop.height));
  return {
    width,
    height,
    x: Math.min(1 - width, Math.max(0, crop.x)),
    y: Math.min(1 - height, Math.max(0, crop.y)),
  };
}

/** How far in a frame-shaped crop is, where 1 is the whole cover. */
export function zoomOf(crop: Crop, imageAspect: number, frameAspect = PORTRAIT_ASPECT): number {
  return coverCrop(imageAspect, frameAspect).width / crop.width;
}

/**
 * The same crop at another zoom, about its own centre -- or about `anchor`
 * (a point in the photograph, 0..1) for a pinch, so what is under the
 * fingers stays under them.
 */
export function zoomCrop(
  crop: Crop,
  zoom: number,
  imageAspect: number,
  frameAspect = PORTRAIT_ASPECT,
  anchor?: { x: number; y: number },
): Crop {
  const z = Math.min(MAX_PORTRAIT_ZOOM, Math.max(1, zoom));
  const base = coverCrop(imageAspect, frameAspect);
  const width = base.width / z;
  const height = base.height / z;

  const ax = anchor?.x ?? crop.x + crop.width / 2;
  const ay = anchor?.y ?? crop.y + crop.height / 2;
  // Where the anchor sat inside the old rectangle, as a proportion, is where
  // it sits inside the new one.
  const px = crop.width > 0 ? (ax - crop.x) / crop.width : 0.5;
  const py = crop.height > 0 ? (ay - crop.y) / crop.height : 0.5;

  return clampCrop({ x: ax - px * width, y: ay - py * height, width, height });
}

/** Slide the crop by a fraction of itself (a drag of the whole frame is 1). */
export function panCrop(crop: Crop, dxFrames: number, dyFrames: number): Crop {
  return clampCrop({
    ...crop,
    x: crop.x + dxFrames * crop.width,
    y: crop.y + dyFrames * crop.height,
  });
}

/**
 * Where the editor starts: what the frame shows today, made frame-shaped so
 * that dragging and zooming have a rectangle of the right proportions to move.
 */
export function startingCrop(
  stored: Crop | null,
  imageAspect: number,
  frameAspect = PORTRAIT_ASPECT,
): Crop {
  return clampCrop(visibleRect(stored, imageAspect, frameAspect));
}

/**
 * The instructions to send: rounded to four places (a tenth of a pixel on a
 * 3000-pixel photograph) and kept inside the picture after rounding, so the
 * server's own bounds check can never refuse what the editor produced.
 */
export function toCropFields(crop: Crop) {
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  const width = clamp01(round(crop.width));
  const height = clamp01(round(crop.height));
  return {
    cropX: Math.min(round(crop.x), round(1 - width)),
    cropY: Math.min(round(crop.y), round(1 - height)),
    cropWidth: width,
    cropHeight: height,
  };
}

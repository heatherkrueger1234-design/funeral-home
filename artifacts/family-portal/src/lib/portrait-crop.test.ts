import { describe, expect, it } from "vitest";
import {
  MAX_PORTRAIT_ZOOM,
  PORTRAIT_ASPECT,
  coverCrop,
  cropImageStyle,
  cropOf,
  panCrop,
  startingCrop,
  toCropFields,
  visibleRect,
  zoomCrop,
  zoomOf,
} from "@workspace/api-client-react";

/**
 * The crop editor's arithmetic, shared with the director's console and
 * mirrored by the print renderer. What matters is that the rectangle the
 * family frames is the rectangle every other screen shows, that it stays a
 * real rectangle inside the photograph however it is dragged, and that what
 * it sends is never something the server's bounds check refuses.
 */

const LANDSCAPE = 3 / 2; // a 6000x4000 camera photograph
const PORTRAIT_PHOTO = 3 / 4; // a phone held upright

/** Width over height, in pixels, of a crop of a photo of this aspect. */
const pixelAspect = (crop: { width: number; height: number }, imageAspect: number) =>
  (crop.width / crop.height) * imageAspect;

describe("the frame", () => {
  it("is the 4:5 of the printed cards", () => {
    expect(PORTRAIT_ASPECT).toBeCloseTo(0.8);
  });

  it("starts as the largest centred 4:5 the photograph has", () => {
    const wide = coverCrop(LANDSCAPE);
    expect(wide.height).toBe(1);
    expect(pixelAspect(wide, LANDSCAPE)).toBeCloseTo(PORTRAIT_ASPECT);
    expect(wide.x + wide.width / 2).toBeCloseTo(0.5);

    const tall = coverCrop(PORTRAIT_PHOTO);
    expect(tall.width).toBe(1);
    expect(pixelAspect(tall, PORTRAIT_PHOTO)).toBeCloseTo(PORTRAIT_ASPECT);
    expect(tall.y + tall.height / 2).toBeCloseTo(0.5);
  });
});

describe("showing a stored crop", () => {
  it("shows a 4:5 crop exactly in a 4:5 frame", () => {
    const crop = { x: 0.6, y: 0.1, width: 0.32, height: 0.8 }; // 128x160 of 400x200
    const rect = visibleRect(crop, 2);
    expect(rect.x).toBeCloseTo(crop.x);
    expect(rect.y).toBeCloseTo(crop.y);
    expect(rect.width).toBeCloseTo(crop.width);
    expect(rect.height).toBeCloseTo(crop.height);
  });

  it("shows the middle of it in a square, as the register page prints it", () => {
    const crop = { x: 0.6, y: 0.1, width: 0.32, height: 0.8 };
    const rect = visibleRect(crop, 2, 1);
    expect(pixelAspect(rect, 2)).toBeCloseTo(1);
    expect(rect.width).toBeCloseTo(crop.width);
    // Trimmed top and bottom equally, never stretched.
    expect(rect.y - crop.y).toBeCloseTo(crop.y + crop.height - (rect.y + rect.height));
  });

  it("never squashes a crop of the wrong shape", () => {
    // "The whole photograph", which is how a director undoes a crop.
    const rect = visibleRect({ x: 0, y: 0, width: 1, height: 1 }, LANDSCAPE);
    expect(pixelAspect(rect, LANDSCAPE)).toBeCloseTo(PORTRAIT_ASPECT);
    expect(rect).toEqual(coverCrop(LANDSCAPE));
  });

  it("treats a missing or half-stored crop as no crop", () => {
    expect(cropOf({ cropX: null, cropY: null, cropWidth: null, cropHeight: null })).toBeNull();
    expect(cropOf({ cropX: 0.1, cropY: null, cropWidth: 0.5, cropHeight: 0.5 })).toBeNull();
    expect(cropOf({ cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0.5 })).toBeNull();
    expect(visibleRect(null, LANDSCAPE)).toEqual(coverCrop(LANDSCAPE));
  });

  it("places the picture so exactly that rectangle fills the frame", () => {
    const style = cropImageStyle({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 });
    expect(style.width).toBe("200%");
    expect(style.height).toBe("400%");
    expect(style.left).toBe("-50%");
    expect(style.top).toBe("-200%");
  });
});

describe("moving and zooming", () => {
  it("zooms about the middle and keeps the frame's shape", () => {
    const start = startingCrop(null, LANDSCAPE);
    const zoomed = zoomCrop(start, 2, LANDSCAPE);
    expect(zoomOf(zoomed, LANDSCAPE)).toBeCloseTo(2);
    expect(pixelAspect(zoomed, LANDSCAPE)).toBeCloseTo(PORTRAIT_ASPECT);
    expect(zoomed.x + zoomed.width / 2).toBeCloseTo(start.x + start.width / 2);
    expect(zoomed.y + zoomed.height / 2).toBeCloseTo(start.y + start.height / 2);
  });

  it("keeps what is under the fingers under them when pinching", () => {
    const start = startingCrop(null, LANDSCAPE);
    const anchor = { x: start.x + start.width * 0.25, y: 0.3 };
    const zoomed = zoomCrop(start, 2, LANDSCAPE, PORTRAIT_ASPECT, anchor);
    const before = (anchor.x - start.x) / start.width;
    const after = (anchor.x - zoomed.x) / zoomed.width;
    expect(after).toBeCloseTo(before);
  });

  it("will not zoom out past the whole picture or in past the limit", () => {
    const start = startingCrop(null, LANDSCAPE);
    expect(zoomOf(zoomCrop(start, 0.2, LANDSCAPE), LANDSCAPE)).toBeCloseTo(1);
    expect(zoomOf(zoomCrop(start, 99, LANDSCAPE), LANDSCAPE)).toBeCloseTo(MAX_PORTRAIT_ZOOM);
  });

  it("cannot be dragged off the photograph", () => {
    const zoomed = zoomCrop(startingCrop(null, LANDSCAPE), 3, LANDSCAPE);
    const far = panCrop(zoomed, 50, -50);
    expect(far.x + far.width).toBeCloseTo(1);
    expect(far.y).toBe(0);
    expect(far.width).toBeCloseTo(zoomed.width);
  });

  it("starts from what is saved, made frame-shaped", () => {
    const saved = { x: 0.6, y: 0.1, width: 0.32, height: 0.8 };
    expect(startingCrop(saved, 2)).toEqual(visibleRect(saved, 2));
  });
});

describe("what is sent", () => {
  it("always lies inside the photograph, as the server insists", () => {
    const awkward = [
      { x: 0.66666666, y: 0.33333333, width: 0.33333334, height: 0.66666667 },
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0.99995, y: 0.99995, width: 0.00005, height: 0.00005 },
      panCrop(zoomCrop(startingCrop(null, LANDSCAPE), 3.7, LANDSCAPE), 9, 9),
    ];
    for (const crop of awkward) {
      const fields = toCropFields(crop);
      expect(fields.cropX).toBeGreaterThanOrEqual(0);
      expect(fields.cropY).toBeGreaterThanOrEqual(0);
      expect(fields.cropX + fields.cropWidth).toBeLessThanOrEqual(1 + 1e-6);
      expect(fields.cropY + fields.cropHeight).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});

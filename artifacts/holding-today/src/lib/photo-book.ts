import { PdfBuilder, measure, wrap, type TextStyle } from "@/lib/pdf";
import { formatWhen } from "@/components/Slideshow";

/**
 * An album, laid out as a book you can print.
 *
 * One photograph to a page, its own words underneath, in the order the person
 * put them in. US Letter portrait, because it prints at home, at a copy shop,
 * and at every photo-book service without anyone having to think about it.
 *
 * The pictures are re-encoded through a canvas on the way in. That is what
 * lets every format the site accepts — JPEG, PNG, GIF, WebP — end up in the
 * same book, and it caps each one at a sensible size for print rather than
 * putting a 40-megapixel original into a file nobody can email.
 */

export type BookPhoto = {
  imageUrl: string;
  title: string;
  description?: string | null;
  dateTaken?: string | null;
};

export type BookOptions = {
  title: string;
  description?: string | null;
  photos: BookPhoto[];
  /** Called after each photograph, so a long book can show progress. */
  onProgress?: (done: number, total: number) => void;
};

const MARGIN = 54; // 0.75in
const CAPTION_HEIGHT = 132;

/**
 * 2200px on the long edge is about 300dpi across a 7-inch page — the density
 * print shops ask for — while staying small enough that a fifty-page book is
 * still a file somebody can actually send to their mother.
 */
const MAX_EDGE = 2200;
const JPEG_QUALITY = 0.92;

const TITLE: TextStyle = { font: "Times-Roman", size: 15 };
const DATE: TextStyle = { font: "Helvetica", size: 9, grey: 0.45 };
const BODY: TextStyle = { font: "Times-Roman", size: 10.5, grey: 0.25 };
const COVER_TITLE: TextStyle = { font: "Times-Roman", size: 30 };
const COVER_BODY: TextStyle = { font: "Times-Italic", size: 12, grey: 0.35 };
const FOOTER: TextStyle = { font: "Helvetica", size: 8, grey: 0.6 };

/**
 * Loads a picture and re-encodes it as a JPEG the PDF can embed directly.
 *
 * `crossOrigin` is deliberately not set: these are same-origin, cookie
 * authenticated URLs, and asking for CORS would break the credentials that
 * make them readable at all.
 */
async function toJpeg(url: string): Promise<Uint8Array | null> {
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = url;
  });
  if (!image || !image.naturalWidth || !image.naturalHeight) return null;

  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) return null;

  // White underneath, because a transparent PNG flattened onto nothing prints
  // as a black rectangle.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildPhotoBook(options: BookOptions): Promise<Blob> {
  const pdf = new PdfBuilder();
  const usableWidth = pdf.pageWidth - MARGIN * 2;

  // ---- the cover ----
  const cover = pdf.addPage();
  const coverLines = wrap(options.title, COVER_TITLE, usableWidth);
  let y = pdf.pageHeight / 2 + 40;
  for (const line of coverLines) {
    pdf.drawCentredText(cover, line, y, COVER_TITLE);
    y -= COVER_TITLE.size * 1.35;
  }
  if (options.description) {
    y -= 14;
    for (const line of wrap(options.description, COVER_BODY, usableWidth - 80)) {
      pdf.drawCentredText(cover, line, y, COVER_BODY);
      y -= COVER_BODY.size * 1.5;
    }
  }

  // ---- one page per photograph ----
  const total = options.photos.length;
  let pageNumber = 0;

  for (let index = 0; index < total; index++) {
    const photo = options.photos[index]!;
    const jpeg = await toJpeg(photo.imageUrl);
    options.onProgress?.(index + 1, total);

    // A picture that will not load is skipped rather than given a blank page.
    if (!jpeg) continue;

    const page = pdf.addPage();
    pageNumber += 1;

    const placed = pdf.drawImageContained(page, jpeg, {
      x: MARGIN,
      y: MARGIN + CAPTION_HEIGHT,
      width: usableWidth,
      height: pdf.pageHeight - MARGIN * 2 - CAPTION_HEIGHT,
    });
    if (!placed) continue;

    let captionY = MARGIN + CAPTION_HEIGHT - 24;

    for (const line of wrap(photo.title, TITLE, usableWidth)) {
      pdf.drawCentredText(page, line, captionY, TITLE);
      captionY -= TITLE.size * 1.3;
    }

    const when = formatWhen(photo.dateTaken);
    if (when) {
      captionY -= 3;
      pdf.drawCentredText(page, when, captionY, DATE);
      captionY -= DATE.size * 1.8;
    }

    if (photo.description) {
      captionY -= 4;
      // Four lines at most, so a long story never runs off the bottom of a
      // page. The whole of it is still in the app; this is the printed copy.
      for (const line of wrap(photo.description, BODY, usableWidth - 60).slice(0, 4)) {
        pdf.drawCentredText(page, line, captionY, BODY);
        captionY -= BODY.size * 1.4;
      }
    }

    const label = String(pageNumber);
    pdf.drawText(page, label, (pdf.pageWidth - measure(label, FOOTER)) / 2, 30, FOOTER);
  }

  return pdf.build();
}

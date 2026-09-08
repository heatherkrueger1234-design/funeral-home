/**
 * A very small PDF writer, enough to lay photographs and words onto pages.
 *
 * Hand-written rather than a dependency, for the same reason the export ZIP
 * is: this needs one narrow thing — JPEG images and base-14 text on a fixed
 * page — and a PDF library is a large amount of code to carry for it.
 *
 * Every image reaching this file is already a JPEG, because the book is built
 * in the browser and the browser re-encodes whatever it was through a canvas
 * first. That is what makes this small: JPEG is the one image format a PDF can
 * embed as-is, with `/DCTDecode` and no re-compression, so a photograph goes
 * in at its original quality and nothing here has to understand PNG's row
 * filters or WebP at all.
 */

const PAGE = { width: 612, height: 792 }; // US Letter, portrait, in points

export type TextStyle = {
  font: "Times-Roman" | "Times-Italic" | "Helvetica";
  size: number;
  /** 0 = black, 1 = white. */
  grey?: number;
};

type ImagePlacement = {
  jpeg: Uint8Array;
  width: number;
  height: number;
  x: number;
  y: number;
  drawWidth: number;
  drawHeight: number;
};

type TextPlacement = {
  text: string;
  x: number;
  y: number;
  style: TextStyle;
};

export type Page = {
  images: ImagePlacement[];
  texts: TextPlacement[];
};

/**
 * PDF's base-14 fonts are indexed by WinAnsiEncoding, which is Latin-1 with
 * the typographic characters people actually type — curly quotes, em dashes —
 * moved into the 0x80..0x9F range. Mapping those explicitly means "don't"
 * and "1998—2019" survive into the printed book instead of becoming noise.
 */
const WIN_ANSI: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84,
  "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88,
  "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c,
  "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93,
  "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b,
  "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

function encodeWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const character of text) {
    const mapped = WIN_ANSI[character];
    if (mapped !== undefined) {
      out.push(mapped);
      continue;
    }
    const code = character.codePointAt(0)!;
    // Anything outside Latin-1 has no glyph in a base-14 font. A space keeps
    // the line's shape; a question mark would look like a mistake in a book
    // about somebody's child.
    out.push(code <= 0xff ? code : 0x20);
  }
  return out;
}

/** `(`, `)` and `\` end or escape a string literal, so they are escaped. */
function pdfString(text: string): string {
  return encodeWinAnsi(text)
    .map((byte) => {
      if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
        return `\\${String.fromCharCode(byte)}`;
      }
      if (byte < 32 || byte > 126) {
        return `\\${byte.toString(8).padStart(3, "0")}`;
      }
      return String.fromCharCode(byte);
    })
    .join("");
}

/**
 * Width of a string, as a fraction of the font size.
 *
 * Real base-14 metrics are a table of 315 numbers per font. These averages
 * are close enough for what they are used for — deciding where to wrap a
 * caption and centring a title — and being a few points out on a line of
 * text is not something anyone will see.
 */
const AVERAGE_GLYPH_WIDTH: Record<TextStyle["font"], number> = {
  "Times-Roman": 0.5,
  "Times-Italic": 0.49,
  Helvetica: 0.55,
};

export function measure(text: string, style: TextStyle): number {
  return text.length * style.size * AVERAGE_GLYPH_WIDTH[style.font];
}

export function wrap(text: string, style: TextStyle, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, style) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Reads a JPEG's pixel dimensions out of its start-of-frame marker. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    // Every SOFn except the ones that are not frames at all.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return {
        height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
      };
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    offset += 2 + length;
  }
  return null;
}

export class PdfBuilder {
  readonly pageWidth = PAGE.width;
  readonly pageHeight = PAGE.height;
  private pages: Page[] = [];

  addPage(): Page {
    const page: Page = { images: [], texts: [] };
    this.pages.push(page);
    return page;
  }

  /**
   * Places a photograph inside a box without ever cropping it, matching the
   * slideshow. A book that trims the top of a child's head to fill a frame is
   * not a book anyone wants.
   */
  drawImageContained(
    page: Page,
    jpeg: Uint8Array,
    box: { x: number; y: number; width: number; height: number },
  ): boolean {
    const size = jpegSize(jpeg);
    if (!size || size.width === 0 || size.height === 0) return false;

    const scale = Math.min(box.width / size.width, box.height / size.height);
    const drawWidth = size.width * scale;
    const drawHeight = size.height * scale;

    page.images.push({
      jpeg,
      width: size.width,
      height: size.height,
      x: box.x + (box.width - drawWidth) / 2,
      y: box.y + (box.height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    });
    return true;
  }

  drawText(page: Page, text: string, x: number, y: number, style: TextStyle) {
    if (text) page.texts.push({ text, x, y, style });
  }

  drawCentredText(page: Page, text: string, y: number, style: TextStyle) {
    if (!text) return;
    this.drawText(page, text, (this.pageWidth - measure(text, style)) / 2, y, style);
  }

  build(): Blob {
    const chunks: Uint8Array[] = [];
    let length = 0;
    const offsets: number[] = [];

    const pushBytes = (bytes: Uint8Array) => {
      chunks.push(bytes);
      length += bytes.length;
    };
    const pushText = (text: string) => {
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
      pushBytes(bytes);
    };

    // Object numbering, fixed up front so references can be written before
    // the objects they point at exist.
    const catalogueId = 1;
    const pagesId = 2;
    const fontIds = { "Times-Roman": 3, "Times-Italic": 4, Helvetica: 5 } as const;
    let nextId = 6;

    const pageIds: number[] = [];
    const pageObjects: { id: number; contentId: number; imageIds: number[] }[] = [];
    for (const page of this.pages) {
      const id = nextId++;
      const contentId = nextId++;
      const imageIds = page.images.map(() => nextId++);
      pageIds.push(id);
      pageObjects.push({ id, contentId, imageIds });
    }
    const totalObjects = nextId - 1;

    const startObject = (id: number) => {
      offsets[id] = length;
      pushText(`${id} 0 obj\n`);
    };

    pushText("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    startObject(catalogueId);
    pushText(`<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`);

    startObject(pagesId);
    pushText(
      `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds
        .map((id) => `${id} 0 R`)
        .join(" ")}] >>\nendobj\n`,
    );

    for (const [name, id] of Object.entries(fontIds)) {
      startObject(id);
      pushText(
        `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>\nendobj\n`,
      );
    }

    this.pages.forEach((page, index) => {
      const { id, contentId, imageIds } = pageObjects[index]!;

      const resources =
        `<< /Font << /F1 ${fontIds["Times-Roman"]} 0 R /F2 ${fontIds["Times-Italic"]} 0 R ` +
        `/F3 ${fontIds.Helvetica} 0 R >> /XObject << ` +
        imageIds.map((imageId, i) => `/Im${i} ${imageId} 0 R`).join(" ") +
        " >> >>";

      startObject(id);
      pushText(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
          `/Resources ${resources} /Contents ${contentId} 0 R >>\nendobj\n`,
      );

      const fontKey: Record<TextStyle["font"], string> = {
        "Times-Roman": "F1",
        "Times-Italic": "F2",
        Helvetica: "F3",
      };

      const operations: string[] = [];
      page.images.forEach((image, i) => {
        operations.push(
          "q",
          `${image.drawWidth.toFixed(2)} 0 0 ${image.drawHeight.toFixed(2)} ` +
            `${image.x.toFixed(2)} ${image.y.toFixed(2)} cm`,
          `/Im${i} Do`,
          "Q",
        );
      });
      for (const text of page.texts) {
        const grey = text.style.grey ?? 0;
        operations.push(
          "BT",
          `${grey} ${grey} ${grey} rg`,
          `/${fontKey[text.style.font]} ${text.style.size} Tf`,
          `${text.x.toFixed(2)} ${text.y.toFixed(2)} Td`,
          `(${pdfString(text.text)}) Tj`,
          "ET",
        );
      }

      const content = operations.join("\n");
      startObject(contentId);
      pushText(`<< /Length ${content.length} >>\nstream\n`);
      pushText(content);
      pushText("\nendstream\nendobj\n");

      page.images.forEach((image, i) => {
        const imageId = imageIds[i]!;
        startObject(imageId);
        pushText(
          `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
            `/Length ${image.jpeg.length} >>\nstream\n`,
        );
        pushBytes(image.jpeg);
        pushText("\nendstream\nendobj\n");
      });
    });

    const xrefOffset = length;
    pushText(`xref\n0 ${totalObjects + 1}\n`);
    pushText("0000000000 65535 f \n");
    for (let id = 1; id <= totalObjects; id++) {
      pushText(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
    }
    pushText(
      `trailer\n<< /Size ${totalObjects + 1} /Root ${catalogueId} 0 R >>\n` +
        `startxref\n${xrefOffset}\n%%EOF\n`,
    );

    return new Blob(chunks as BlobPart[], { type: "application/pdf" });
  }
}

import { describe, expect, it } from "vitest";
import { PdfBuilder, jpegSize, measure, wrap } from "./pdf";

/**
 * The PDF writer is hand-rolled, so the parts that would fail silently get
 * tests. A book that opens but has the wrong bytes in it is the bad outcome
 * here: nobody discovers it until they are standing at a print shop.
 */

/** A JPEG header with a real SOF0 marker declaring 1200x800. */
function jpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, // APP0, length 16
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, // SOF0, length 17, 8-bit
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
}

async function bytesOf(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return new TextDecoder("latin1").decode(buffer);
}

describe("jpegSize", () => {
  it("reads the dimensions out of the start-of-frame marker", () => {
    expect(jpegSize(jpegHeader(1200, 800))).toEqual({ width: 1200, height: 800 });
    expect(jpegSize(jpegHeader(600, 1800))).toEqual({ width: 600, height: 1800 });
  });

  it("returns null rather than guessing at something that is not a JPEG", () => {
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegSize(new Uint8Array([]))).toBeNull();
  });
});

describe("wrap", () => {
  const style = { font: "Times-Roman", size: 10 } as const;

  it("breaks a caption into lines that fit", () => {
    const text =
      "Would not come out of the water until his lips went blue, and he said he was not cold.";
    const lines = wrap(text, style, 200);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measure(line, style)).toBeLessThanOrEqual(200);
    }
    // Nothing is dropped on the floor.
    expect(lines.join(" ")).toBe(text);
  });

  it("keeps a word that is wider than the line rather than losing it", () => {
    const lines = wrap("Bartholomew", style, 5);
    expect(lines).toEqual(["Bartholomew"]);
  });
});

describe("the built file", () => {
  it("is a PDF with the pages it was given", async () => {
    const pdf = new PdfBuilder();
    const first = pdf.addPage();
    pdf.drawCentredText(first, "His last year", 500, { font: "Times-Roman", size: 30 });
    pdf.addPage();

    const text = await bytesOf(pdf.build());

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Count 2");
    expect(text).toContain("(His last year) Tj");
  });

  it("embeds a JPEG without re-compressing it", async () => {
    const pdf = new PdfBuilder();
    const page = pdf.addPage();
    const jpeg = jpegHeader(1000, 500);

    expect(
      pdf.drawImageContained(page, jpeg, { x: 0, y: 0, width: 400, height: 400 }),
    ).toBe(true);

    const text = await bytesOf(pdf.build());
    expect(text).toContain("/Filter /DCTDecode");
    expect(text).toContain("/Width 1000");
    expect(text).toContain("/Height 500");
  });

  it("fits a photograph inside its box instead of cropping it", async () => {
    const pdf = new PdfBuilder();
    const page = pdf.addPage();
    // Twice as wide as it is tall, into a square box.
    pdf.drawImageContained(page, jpegHeader(1000, 500), {
      x: 50,
      y: 100,
      width: 400,
      height: 400,
    });

    const placed = page.images[0]!;
    expect(placed.drawWidth).toBeCloseTo(400);
    expect(placed.drawHeight).toBeCloseTo(200);
    // Centred in the box, so the aspect ratio is kept and nothing is cut off.
    expect(placed.x).toBeCloseTo(50);
    expect(placed.y).toBeCloseTo(200);
  });

  it("refuses an image it cannot measure rather than writing a broken page", async () => {
    const pdf = new PdfBuilder();
    const page = pdf.addPage();
    const notAJpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    expect(
      pdf.drawImageContained(page, notAJpeg, { x: 0, y: 0, width: 100, height: 100 }),
    ).toBe(false);
    expect(page.images).toHaveLength(0);
  });

  it("escapes the characters that would otherwise end a string", async () => {
    const pdf = new PdfBuilder();
    const page = pdf.addPage();
    pdf.drawText(page, "(his laugh) \\ a note", 10, 10, {
      font: "Times-Roman",
      size: 10,
    });

    const text = await bytesOf(pdf.build());
    expect(text).toContain("(\\(his laugh\\) \\\\ a note) Tj");
  });

  it("keeps the typographic characters people actually type", async () => {
    const pdf = new PdfBuilder();
    const page = pdf.addPage();
    // An em dash and a curly apostrophe, which is what a phone keyboard gives.
    pdf.drawText(page, "1998–2019 he wouldn’t", 10, 10, {
      font: "Times-Roman",
      size: 10,
    });

    const text = await bytesOf(pdf.build());
    // WinAnsi: en dash is 0226 octal, right single quote is 0222 octal.
    expect(text).toContain("\\226");
    expect(text).toContain("\\222");
  });

  it("writes a cross-reference offset for every object", async () => {
    const pdf = new PdfBuilder();
    const page = pdf.addPage();
    pdf.drawImageContained(page, jpegHeader(100, 100), {
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });

    const text = await bytesOf(pdf.build());
    const size = Number(/\/Size (\d+)/.exec(text)![1]);
    const entries = text.match(/^\d{10} \d{5} [nf] $/gm) ?? [];
    expect(entries).toHaveLength(size);

    // The startxref value must point at the word "xref" itself.
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
  });
});

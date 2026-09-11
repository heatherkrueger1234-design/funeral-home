/**
 * Content sniffing for uploads.
 *
 * A browser-supplied `Content-Type` is just a string the client chose; it is
 * not evidence of anything. Since these bytes are later served back with a
 * content type, trusting the claim would let someone store HTML or SVG as
 * `image/png` and get it rendered as a document on this origin. So the type
 * is determined from the bytes and the client's claim is discarded.
 *
 * HEIC and AVIF are recognised here but never stored as-is. An iPhone shoots
 * HEIC by default, so refusing it means a family's photographs of their
 * mother fail at the door — and storing it means Chrome and Firefox render a
 * broken image. Both are transcoded to JPEG on the way in; see `images.ts`.
 *
 * Deliberately excluded: SVG, which is a script-bearing document rather than
 * an image.
 *
 * Audio is here so that a slideshow can have their song under it. Only
 * formats every current browser can actually play — an uploaded file that
 * silently refuses to play is worse than one that was refused at the door.
 */

type Signature = {
  mimeType: string;
  extensions: readonly string[];
  matches: (bytes: Buffer) => boolean;
  /** What this type is for, so the two size ceilings can differ. */
  kind: "image" | "document" | "audio";
};

const startsWith = (bytes: Buffer, ...prefix: number[]): boolean =>
  bytes.length >= prefix.length &&
  prefix.every((byte, index) => bytes[index] === byte);

const SIGNATURES: readonly Signature[] = [
  {
    mimeType: "image/jpeg",
    kind: "image",
    extensions: ["jpg", "jpeg"],
    matches: (b) => startsWith(b, 0xff, 0xd8, 0xff),
  },
  {
    mimeType: "image/png",
    kind: "image",
    extensions: ["png"],
    matches: (b) => startsWith(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  },
  {
    mimeType: "image/gif",
    kind: "image",
    extensions: ["gif"],
    matches: (b) => b.subarray(0, 6).toString("latin1").match(/^GIF8[79]a$/) !== null,
  },
  {
    mimeType: "image/webp",
    kind: "image",
    extensions: ["webp"],
    matches: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString("latin1") === "RIFF" &&
      b.subarray(8, 12).toString("latin1") === "WEBP",
  },
  {
    /*
     * ISO base media: `....ftyp<brand>` at offset 4. The brand list is what
     * separates a photograph from an MP4 — an iPhone HEIC is `heic` or
     * `mif1`, a burst or live photo can be `msf1`, and newer devices and
     * Android emit `avif`.
     */
    mimeType: "image/heic",
    kind: "image",
    extensions: ["heic", "heif"],
    matches: (b) =>
      b.length >= 12 &&
      b.subarray(4, 8).toString("latin1") === "ftyp" &&
      ["heic", "heix", "heim", "heis", "hevc", "hevm", "hevs", "mif1", "msf1"].includes(
        b.subarray(8, 12).toString("latin1"),
      ),
  },
  {
    mimeType: "image/avif",
    kind: "image",
    extensions: ["avif"],
    matches: (b) =>
      b.length >= 12 &&
      b.subarray(4, 8).toString("latin1") === "ftyp" &&
      ["avif", "avis"].includes(b.subarray(8, 12).toString("latin1")),
  },
  {
    mimeType: "application/pdf",
    kind: "document",
    extensions: ["pdf"],
    // Records people scan — death certificates, autopsy reports, insurance.
    matches: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  },
  {
    mimeType: "audio/mpeg",
    kind: "audio",
    extensions: ["mp3"],
    // Either an ID3 tag, or a bare MPEG frame sync: 11 set bits.
    matches: (b) =>
      b.subarray(0, 3).toString("latin1") === "ID3" ||
      (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0),
  },
  {
    mimeType: "audio/mp4",
    kind: "audio",
    extensions: ["m4a"],
    // Only the audio brand. An MP4 video also starts "ftyp", and a video in
    // the slot marked "their song" is not what anyone meant.
    matches: (b) =>
      b.length >= 12 &&
      b.subarray(4, 8).toString("latin1") === "ftyp" &&
      b.subarray(8, 12).toString("latin1") === "M4A ",
  },
  {
    mimeType: "audio/wav",
    kind: "audio",
    extensions: ["wav"],
    matches: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString("latin1") === "RIFF" &&
      b.subarray(8, 12).toString("latin1") === "WAVE",
  },
  {
    mimeType: "audio/ogg",
    kind: "audio",
    extensions: ["ogg"],
    matches: (b) => b.subarray(0, 4).toString("latin1") === "OggS",
  },
  {
    mimeType: "audio/flac",
    kind: "audio",
    extensions: ["flac"],
    matches: (b) => b.subarray(0, 4).toString("latin1") === "fLaC",
  },
];

export type DetectedType = {
  mimeType: string;
  extension: string;
  kind: "image" | "document" | "audio";
};

export function detectFileType(bytes: Buffer): DetectedType | null {
  const signature = SIGNATURES.find((candidate) => candidate.matches(bytes));

  return signature
    ? {
        mimeType: signature.mimeType,
        extension: signature.extensions[0]!,
        kind: signature.kind,
      }
    : null;
}

export function isAudio(mimeType: string): boolean {
  return SIGNATURES.some(
    (signature) => signature.mimeType === mimeType && signature.kind === "audio",
  );
}

export const ACCEPTED_TYPES: readonly string[] = SIGNATURES.map(
  (signature) => signature.mimeType,
);

/** For the file picker's `accept` attribute and for error copy. */
export const ACCEPTED_DESCRIPTION =
  "JPEG, PNG, GIF, WebP, PDF, or MP3, M4A, WAV, OGG or FLAC audio";

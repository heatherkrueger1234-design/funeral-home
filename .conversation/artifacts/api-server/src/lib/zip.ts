import { createHash } from "node:crypto";
import type { Writable } from "node:stream";

/**
 * A minimal, streaming, store-only ZIP writer.
 *
 * This exists so the photographs a family collected can leave as a folder.
 * A director's next step after the family finishes uploading is to put the
 * pictures into slideshow software, and "log in and save forty images one at
 * a time, in the right order, guessing which is which" is the point where a
 * tool stops saving anyone time. The pack is numbered in slideshow order and
 * carries the captions, so it opens as a finished job.
 *
 * Store-only (no compression) because the payload is JPEGs and PNGs, which
 * deflate cannot meaningfully shrink — it would cost CPU per byte to save
 * almost nothing. Written by hand rather than by pulling in an archiver
 * dependency: the format needed here is about eighty lines, and this is a
 * codebase where a bereaved parent's photographs pass through every new
 * dependency.
 *
 * Entries are written one at a time and flushed, so peak memory is one file
 * (capped at 15 MB by the upload route) rather than the whole archive.
 *
 * Deliberately not implemented: ZIP64, which means a hard 4 GB ceiling on the
 * whole archive and on any offset within it.
 *
 * That ceiling used to be comfortable: a case was capped at 50 photographs of
 * 15 MB, so 750 MB with room to spare. The cap is now 1000 photographs,
 * because families genuinely have a thousand pictures of their mother and
 * being told to pick fifty before uploading is the thing this product exists
 * to stop. A thousand at 15 MB is 15 GB, four times past what these fields can
 * describe.
 *
 * `addFile` refuses rather than writing an archive that unzips to garbage. But
 * a refusal part-way through a streaming download is itself a bad failure: the
 * client has already had a 200 and half the bytes, and what it sees is a
 * truncated file rather than an error. So callers building an archive that
 * could plausibly get near the ceiling should ask `wouldOverflow` first and
 * answer with a real HTTP error before writing anything. See the case export.
 */

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_SIG = 0x06054b50;
const ZIP_MAX = 0xffffffff;

/** CRC-32, which the format requires per entry. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, which is what the format stores. */
function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (Math.floor(date.getSeconds() / 2) & 0x1f),
    // Years are counted from 1980, and the format cannot represent earlier.
    date:
      ((Math.max(1980, date.getFullYear()) - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

type Entry = {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
};

export class ZipWriter {
  private readonly entries: Entry[] = [];
  private offset = 0;
  private finished = false;

  constructor(private readonly out: Writable) {}

  /**
   * Names are sanitised rather than trusted. A filename comes from whatever
   * the uploader called the file, and `../` in a zip entry is a well-known way
   * to write outside the extraction directory when it is unpacked.
   */
  static safeName(name: string): string {
    return (
      name
        .replace(/\\/g, "/")
        .split("/")
        .filter((part) => part && part !== "." && part !== "..")
        .join("/")
        .replace(/[\x00-\x1f]/g, "")
        .slice(0, 180) || "file"
    );
  }

  /**
   * Whether adding this many more bytes would pass what the format can
   * describe. Ask before starting to stream, not half way through.
   *
   * The central directory is written after the entries and is itself counted
   * by a 32-bit offset, so the check leaves room for it: roughly 46 bytes plus
   * a filename per entry, rounded up generously to 4 KB per file because
   * getting this wrong produces an archive that appears to download fine and
   * will not open.
   */
  wouldOverflow(additionalBytes: number, additionalFiles = 1): boolean {
    const directory = (this.entries.length + additionalFiles) * 4096;
    return this.offset + additionalBytes + directory > ZIP_MAX;
  }

  async addFile(name: string, contents: Buffer, modified = new Date()): Promise<void> {
    if (this.finished) throw new Error("Archive is already finished.");
    if (this.wouldOverflow(contents.length)) {
      throw new Error("Archive is too large for a non-ZIP64 archive.");
    }

    const nameBytes = Buffer.from(ZipWriter.safeName(name), "utf8");
    const crc = crc32(contents);
    const { time, date } = dosDateTime(modified);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 filenames
    header.writeUInt16LE(0, 8); // method: stored
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(contents.length, 18); // compressed
    header.writeUInt32LE(contents.length, 22); // uncompressed
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28); // extra field length

    this.entries.push({
      name: nameBytes,
      crc,
      size: contents.length,
      offset: this.offset,
      time,
      date,
    });

    await this.write(Buffer.concat([header, nameBytes, contents]));
    this.offset += header.length + nameBytes.length + contents.length;
  }

  /** Writes the central directory. Nothing may be added afterwards. */
  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;

    const start = this.offset;
    const records: Buffer[] = [];

    for (const entry of this.entries) {
      const record = Buffer.alloc(46);
      record.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
      record.writeUInt16LE(20, 4); // version made by
      record.writeUInt16LE(20, 6); // version needed
      record.writeUInt16LE(0x0800, 8);
      record.writeUInt16LE(0, 10); // stored
      record.writeUInt16LE(entry.time, 12);
      record.writeUInt16LE(entry.date, 14);
      record.writeUInt32LE(entry.crc, 16);
      record.writeUInt32LE(entry.size, 20);
      record.writeUInt32LE(entry.size, 24);
      record.writeUInt16LE(entry.name.length, 28);
      record.writeUInt16LE(0, 30); // extra
      record.writeUInt16LE(0, 32); // comment
      record.writeUInt16LE(0, 34); // disk number
      record.writeUInt16LE(0, 36); // internal attrs
      record.writeUInt32LE(0, 38); // external attrs
      record.writeUInt32LE(entry.offset, 42);
      records.push(record, entry.name);
    }

    const directory = Buffer.concat(records);

    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_CENTRAL_SIG, 0);
    end.writeUInt16LE(0, 4); // this disk
    end.writeUInt16LE(0, 6); // disk with directory
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(start, 16);
    end.writeUInt16LE(0, 20); // comment length

    await this.write(Buffer.concat([directory, end]));
  }

  /** Respects backpressure, so a large archive cannot outrun a slow client. */
  private write(chunk: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.out.write(chunk, (error) => (error ? reject(error) : resolve()));
    });
  }
}

/** A short, stable suffix so two exports on the same day are distinguishable. */
export function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

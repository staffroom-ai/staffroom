/**
 * A zip file, written by hand.
 *
 * Sixty lines against a dependency, for a format that has not changed since
 * 1989. The alternative is another package in the install path of a CLI whose
 * whole pitch is `npx staffroom` on a machine with nothing on it, and a supply
 * chain that reaches somebody's business folder.
 *
 * Stored rather than deflated. What goes in these archives is a few text files;
 * compressing them would save nothing worth the CRC and size bookkeeping that
 * deflate needs to get right, and a stored entry is something anybody can verify
 * by eye with `unzip -l`.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

export interface ZipEntry {
  /** Path inside the archive, always with forward slashes. */
  path: string;
  data: Buffer | string;
}

/** The CRC-32 zip requires. Table built once, because it is used per byte. */
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = (TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Builds the archive in memory.
 *
 * In memory because these are small by construction — a log, some config, a
 * doctor report. Anything big enough to need streaming is something this should
 * not be putting in a support bundle in the first place.
 */
export function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path.split("\\").join("/"), "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const sum = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // stored, not deflated
    // No timestamp. A bundle that differs byte for byte between two runs of the
    // same office is a bundle nobody can diff, and the date is in the report.
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const dir = Buffer.alloc(46 + name.length);
    dir.writeUInt32LE(0x02014b50, 0); // central directory header
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    name.copy(dir, 46);

    locals.push(local, data);
    central.push(dir);
    offset += local.length + data.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, directory, end]);
}

export function writeZip(path: string, entries: ZipEntry[]): void {
  writeFileSync(path, zip(entries));
}

/** A short, stable fingerprint, for saying two bundles are the same one. */
export function digest(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 12);
}

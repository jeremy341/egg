import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

/**
 * A tar writer that does what it is told, for tests of an archive that must be refused: it can write an
 * absolute path, a `..` segment, a link to anywhere, or a device, none of which a normal tar tool will
 * produce. Names and link targets must fit the 100 bytes of a plain header.
 */

export type RawEntry = {
  name: string;
  /** "0" file, "1" hard link, "2" symbolic link, "3" character device, "4" block device, "5" folder, "6" pipe. */
  type?: "0" | "1" | "2" | "3" | "4" | "5" | "6";
  linkname?: string;
  content?: string | Buffer;
};

const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, "0") + "\0";

function header(e: RawEntry, size: number): Buffer {
  const h = Buffer.alloc(512);
  h.write(e.name, 0, 100, "utf8");
  h.write(octal(e.type === "5" ? 0o755 : 0o644, 8), 100, 8, "ascii");
  h.write(octal(0, 8), 108, 8, "ascii");
  h.write(octal(0, 8), 116, 8, "ascii");
  h.write(octal(size, 12), 124, 12, "ascii");
  h.write(octal(0, 12), 136, 12, "ascii");
  h.write("        ", 148, 8, "ascii");
  h.write(e.type ?? "0", 156, 1, "ascii");
  if (e.linkname) h.write(e.linkname, 157, 100, "utf8");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return h;
}

/** The .tar.gz bytes for these entries. */
export function rawTarGz(entries: RawEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const body = Buffer.from(e.content ?? "");
    const carries = !e.type || e.type === "0";
    blocks.push(header(e, carries ? body.length : 0));
    if (carries && body.length > 0) {
      blocks.push(body, Buffer.alloc((512 - (body.length % 512)) % 512));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

export const sha256Of = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** A small release that passes every check: an app with a start file. */
export function goodRelease(extra: RawEntry[] = []): Buffer {
  return rawTarGz([
    { name: "./", type: "5" },
    { name: "./server.js", content: "require('http').createServer((q,r)=>r.end('ok')).listen(process.env.PORT)\n" },
    ...extra,
  ]);
}

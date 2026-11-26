import { createReadStream, openSync, readSync, closeSync } from "node:fs";
import * as tar from "tar";
import { BuildError, resolveInside } from "@/server/deploy/build";
import { selectLockfile, type ProjectFiles } from "@/server/deploy/runtime";

/**
 * Look inside a finished release that GitHub sent, before anything is unpacked anywhere. Every entry
 * is read from the archive's headers and checked; nothing is written to disk. The archive comes from
 * outside Egg, so a bad one is refused with a plain reason and the unpack never starts.
 *
 * Refused: a path that is absolute or has a `..` segment, a symbolic link whose target leaves the
 * release (found by following the archive's own links), a hard link outside it, a device, a pipe or
 * any other special file, more than MAX_ENTRIES entries, and more than MAX_UNPACKED_BYTES once unpacked.
 */

export const MAX_ENTRIES = 200_000;
/** What the release may take on disk when unpacked. The container's build budget is the same figure. */
export const MAX_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024;
/** Longest package.json read to learn the Node version a release asks for. */
const PACKAGE_JSON_MAX = 1024 * 1024;
const MAX_LINK_STEPS = 255;

export class ArchiveError extends Error {}

export type ArchiveInfo = {
  entries: number;
  unpackedBytes: number;
  /** What the release root holds, for choosing the production install. */
  files: ProjectFiles;
};

export type ArchiveLimits = { maxEntries?: number; maxUnpackedBytes?: number };

/** A folder that does not exist: only used so resolveInside can refuse paths that leave it. */
const VIRTUAL_ROOT = "/egg-release";

const KINDS = new Set(["File", "OldFile", "ContiguousFile", "Directory", "GNUDumpDir", "SymbolicLink", "Link"]);

function clean(raw: string, what: string): string[] {
  if (raw.length === 0 || raw.length > 4096) throw new ArchiveError(`The archive has ${what} that is empty or too long.`);
  if (raw.includes("\u0000") || raw.includes("\\")) throw new ArchiveError(`The archive has ${what} with characters that are not allowed.`);
  if (raw.startsWith("/")) throw new ArchiveError(`The archive has ${what} with an absolute path, so it was refused.`);
  const parts = raw.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.includes("..")) throw new ArchiveError(`The archive has ${what} that climbs out of the release with "..", so it was refused.`);
  try {
    resolveInside(VIRTUAL_ROOT, parts.join("/"));
  } catch (e) {
    if (e instanceof BuildError) throw new ArchiveError(`The archive has ${what} outside the release, so it was refused.`);
    throw e;
  }
  return parts;
}

/**
 * Follow `parts` through the archive's own symbolic links, one name at a time, the way unpacking would.
 * Returns where it lands, relative to the release, or null when it leaves the release or loops.
 */
function landing(parts: string[], links: Map<string, string>): string[] | null {
  const out: string[] = [];
  const queue = [...parts];
  let steps = 0;
  while (queue.length > 0) {
    const part = queue.shift() as string;
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    const target = links.get([...out, part].join("/"));
    if (target !== undefined) {
      if (++steps > MAX_LINK_STEPS || target.startsWith("/")) return null;
      queue.unshift(...target.split("/"));
      continue;
    }
    out.push(part);
  }
  return out;
}

/** True if resolving this path steps through any archived symlink, including chained links. */
function followsSymlink(parts: string[], links: Map<string, string>): boolean {
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return true;
      out.pop();
      continue;
    }
    const target = links.get([...out, part].join("/"));
    if (target !== undefined) {
      return true;
    }
    out.push(part);
  }
  return false;
}

/** Read every header of a .tar.gz and refuse it if anything in it could leave the release or exhaust the container. */
export function inspectArchive(file: string, limits: ArchiveLimits = {}): Promise<ArchiveInfo> {
  const maxEntries = limits.maxEntries ?? MAX_ENTRIES;
  const maxBytes = limits.maxUnpackedBytes ?? MAX_UNPACKED_BYTES;

  const head = Buffer.alloc(2);
  const fd = openSync(file, "r");
  try {
    readSync(fd, head, 0, 2, 0);
  } finally {
    closeSync(fd);
  }
  if (head[0] !== 0x1f || head[1] !== 0x8b) {
    return Promise.reject(new ArchiveError("The upload is not a gzipped tar archive (.tar.gz)."));
  }

  return new Promise<ArchiveInfo>((resolve, reject) => {
    const seen = new Map<string, boolean>(); // path -> is a link
    const links = new Map<string, string>(); // symbolic link path -> target
    const hard: { path: string; target: string[] }[] = [];
    const rootFiles = new Set<string>();
    let packageJson: Buffer[] | null = null;
    let count = 0;
    let bytes = 0;
    let finished = false;

    const src = createReadStream(file);
    const parser = new tar.Parser({ strict: true });

    const finish = (err?: unknown) => {
      if (finished) return;
      finished = true;
      src.destroy();
      if (err) reject(err);
      else {
        try {
          resolve(summary());
        } catch (e) {
          reject(e);
        }
      }
    };

    const summary = (): ArchiveInfo => {
      // Every link is followed through the archive's other links; a hard link must name a path inside it.
      for (const [from, target] of links) {
        const parent = from.split("/").slice(0, -1);
        if (landing([...parent, ...target.split("/")], links) === null) {
          throw new ArchiveError("The archive has a symbolic link that points outside the release, so it was refused.");
        }
      }
      for (const h of hard) {
        if (landing(h.target, links) === null) {
          throw new ArchiveError("The archive has a hard link that points outside the release, so it was refused.");
        }
        // A hard link to a symlink relocates that symlink inode. Its relative
        // target would then be interpreted from the hard link's new directory,
        // which can escape even when the original symlink stayed in the release.
        if (followsSymlink(h.target, links)) {
          throw new ArchiveError("The archive has a hard link that refers to a symbolic link, so it was refused.");
        }
      }
      let pkg: { engines?: { node?: unknown }; scripts?: { build?: unknown }; packageManager?: unknown } | null = null;
      if (packageJson) {
        try {
          pkg = JSON.parse(Buffer.concat(packageJson).toString("utf8"));
        } catch {
          pkg = null; // a broken package.json shows up when the app is installed
        }
      }
      const engine = typeof pkg?.engines?.node === "string" ? pkg.engines.node.trim().slice(0, 200) : "";
      return {
        entries: count,
        unpackedBytes: bytes,
        files: {
          lockfile: selectLockfile((name) => rootFiles.has(name), pkg?.packageManager),
          hasPackageJson: rootFiles.has("package.json"),
          hasBuildScript: typeof pkg?.scripts?.build === "string",
          hasRequirements: rootFiles.has("requirements.txt"),
          hasPyproject: rootFiles.has("pyproject.toml"),
          hasGemfile: rootFiles.has("Gemfile"),
          hasComposer: rootFiles.has("composer.json"),
          hasCargoLock: rootFiles.has("Cargo.lock"),
          hasMaven: rootFiles.has("pom.xml"),
          hasGradle: rootFiles.has("build.gradle") || rootFiles.has("build.gradle.kts"),
          nodeEngine: engine || null,
        },
      };
    };

    parser.on("entry", (entry: tar.ReadEntry) => {
      if (finished) {
        entry.resume();
        return;
      }
      try {
        count++;
        if (count > maxEntries) {
          throw new ArchiveError(`The archive has more than ${maxEntries.toLocaleString("en-US")} files, so it was refused.`);
        }
        const type = String(entry.type);
        if (!KINDS.has(type)) {
          throw new ArchiveError("The archive has a device, pipe or other special file, so it was refused.");
        }
        const parts = clean(entry.path, "a file");
        const key = parts.join("/");
        const isLink = type === "SymbolicLink" || type === "Link";
        if (key === "" && isLink) throw new ArchiveError("The archive has a link in place of the release folder, so it was refused.");
        if (key !== "") {
          const earlier = seen.get(key);
          if (earlier !== undefined && (earlier || isLink)) {
            throw new ArchiveError("The archive names the same path twice with a link among them, so it was refused.");
          }
          seen.set(key, isLink);
        }
        if (type === "SymbolicLink") {
          const target = String(entry.linkpath ?? "");
          if (target === "" || target.length > 4096 || target.includes("\u0000") || target.includes("\\")) {
            throw new ArchiveError("The archive has a symbolic link with a target that is not allowed, so it was refused.");
          }
          if (target.startsWith("/")) {
            throw new ArchiveError("The archive has a symbolic link to an absolute path, so it was refused.");
          }
          links.set(key, target);
        } else if (type === "Link") {
          hard.push({ path: key, target: clean(String(entry.linkpath ?? ""), "a hard link") });
        } else if (type === "Directory" || type === "GNUDumpDir") {
          // nothing to add
        } else {
          bytes += entry.size ?? 0;
          if (bytes > maxBytes) {
            throw new ArchiveError(`The release is larger than ${Math.round(maxBytes / 1024 / 1024)} MB once unpacked, so it was refused.`);
          }
          if (parts.length === 1) rootFiles.add(parts[0]);
          if (key === "package.json" && (entry.size ?? 0) <= PACKAGE_JSON_MAX) {
            const chunks: Buffer[] = [];
            packageJson = chunks;
            entry.on("data", (d: Buffer) => chunks.push(d));
            return;
          }
        }
        entry.resume();
      } catch (e) {
        entry.resume();
        finish(e);
      }
    });
    parser.on("end", () => finish());
    parser.on("error", () => finish(new ArchiveError("The archive could not be read. It may be damaged or not a .tar.gz.")));
    src.on("error", () => finish(new ArchiveError("The archive could not be read.")));
    src.pipe(parser);
  });
}

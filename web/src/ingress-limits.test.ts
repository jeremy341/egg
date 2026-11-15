import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { config as proxyConfig, proxy } from "@/proxy";
import { JSON_BODY_LIMIT } from "@/server/body-limit";
import { MAX_ARCHIVE_BYTES } from "@/server/deploy/build";
import { UPLOAD_LIMIT } from "@/server/files-paths";
import { REPORT_BODY_LIMIT } from "@/server/security-reports";

/**
 * Next.js copies the body of every proxied request into memory before a route can refuse it. These tests keep
 * that copy small, keep the routes with large bodies out of the proxy, and keep deploy/Caddyfile (which refuses
 * oversized bodies before the app sees them) in step with the limits the app enforces itself.
 */

const MIB = 1024 * 1024;
const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** Bytes from a size such as "1mb", "5MiB" or 1048576. Both spellings mean powers of 1024 in Next and in Caddy. */
function bytesOf(size: string | number): number {
  if (typeof size === "number") return size;
  const m = /^(\d+)\s*(b|kb|kib|mb|mib|gb|gib)$/i.exec(size.trim());
  if (!m) throw new Error(`Unreadable size: ${size}`);
  const unit = m[2].toLowerCase();
  const factor = unit === "b" ? 1 : unit.startsWith("k") ? 1024 : unit.startsWith("m") ? MIB : 1024 * MIB;
  return Number(m[1]) * factor;
}

const WEBHOOK_BYTES = (() => {
  const m = /const MAX_BODY_BYTES = (\d+) \* 1024 \* 1024;/.exec(read("src/app/api/webhooks/github/route.ts"));
  if (!m) throw new Error("The webhook body cap was not found in its route.");
  return Number(m[1]) * MIB;
})();

/** The routes whose body is allowed to be larger than the framework buffer, with the cap the app enforces. */
const LARGE_ROUTES = [
  { name: "build upload", sample: "/api/builds/upload", bytes: MAX_ARCHIVE_BYTES, file: "src/app/api/builds/upload/route.ts" },
  { name: "file write", sample: "/api/projects/abc123/files/write", bytes: UPLOAD_LIMIT, file: "src/app/api/projects/[id]/files/write/route.ts" },
  { name: "GitHub webhook", sample: "/api/webhooks/github", bytes: WEBHOOK_BYTES, file: "src/app/api/webhooks/github/route.ts" },
  { name: "security report", sample: "/api/security-reports", bytes: REPORT_BODY_LIMIT, file: "src/app/api/security-reports/route.ts" },
];

function bufferedBytes(): number {
  const size = nextConfig.experimental?.proxyClientMaxBodySize;
  if (size === undefined) throw new Error("proxyClientMaxBodySize must be set: the Next.js default is 10 MB.");
  return bytesOf(size);
}

/** Whether the proxy runs for a path, compiled the way Next.js compiles a matcher. */
function proxied(p: string): boolean {
  return unstable_doesMiddlewareMatch({ config: proxyConfig, nextConfig, url: p });
}

describe("the framework body buffer", () => {
  it("is at most 1 MiB, so a proxied request holds little memory before its route runs", () => {
    expect(bufferedBytes()).toBeLessThanOrEqual(MIB);
  });

  it("still holds a whole JSON body, because a cut body would be read as a different request", () => {
    expect(bufferedBytes()).toBeGreaterThanOrEqual(JSON_BODY_LIMIT);
  });
});

describe("routes with large bodies", () => {
  it.each(LARGE_ROUTES)("$name is not proxied, so its body is not copied into memory by the framework", ({ sample, bytes }) => {
    expect(bytes).toBeGreaterThan(bufferedBytes());
    expect(proxied(sample)).toBe(false);
  });

  it("skipping the proxy removes no protection: the public ones passed through it unchecked, the file route checks the session itself", () => {
    for (const p of ["/api/webhooks/github", "/api/security-reports", "/api/builds/upload"]) {
      const res = proxy(new NextRequest(`http://localhost:3100${p}`, { method: "POST" }));
      expect(res.status, p).toBe(200);
    }
    const route = read("src/app/api/projects/[id]/files/write/route.ts");
    expect(route.indexOf("await authed()")).toBeGreaterThan(-1);
    expect(route.indexOf("await authed()")).toBeLessThan(route.indexOf("readBytesLimited(req"));
  });

  it("only those exact paths are skipped: lookalikes and every other API route still go through the proxy", () => {
    for (const p of [
      "/api/builds/env",
      "/api/builds/other",
      "/api/builds/upload/extra",
      "/api/projects/abc123/files/read",
      "/api/projects/abc123/files/write/extra",
      "/api/projects/abc123/files",
      "/api/projects/files/write",
      "/api/webhooks/github/extra",
      "/api/webhooks/githubx",
      "/api/security-reports/abc",
      "/api/admin/security-reports",
      "/api/tokens",
      "/api/projects",
      "/api/v1/projects",
      "/projects/abc123",
      "/dashboard",
    ]) {
      expect(proxied(p), p).toBe(true);
    }
  });

  it("no route that reads a raw or big body is missing from the list above", () => {
    const known = new Set(LARGE_ROUTES.map((r) => r.file));
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name === "route.ts") {
          const src = readFileSync(full, "utf8");
          if (/readBytesLimited\(|\.formData\(|\.arrayBuffer\(|\breq\.body\b|\brequest\.body\b/.test(src)) {
            found.push(path.relative(root, full).replace(/\\/g, "/"));
          }
        }
      }
    };
    walk(path.join(root, "src/app/api"));
    const unlisted = found.filter((f) => !known.has(f));
    expect(
      unlisted,
      "Add the route to LARGE_ROUTES, skip it in src/proxy.ts and cap it in deploy/Caddyfile, or keep its body under the buffer."
    ).toEqual([]);
  });
});

/** The request_body blocks of deploy/Caddyfile, with their matcher evaluated for a path. */
function caddyLimits() {
  const text = read("../deploy/Caddyfile")
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
  type Clause = { negate: boolean; kind: "path" | "path_regexp"; args: string[] };
  const matchers = new Map<string, Clause[]>();
  // One line: @name path /a /b
  for (const m of text.matchAll(/^\t@(\w+) (path|path_regexp) (.+)$/gm)) {
    matchers.set(m[1], [{ negate: false, kind: m[2] as Clause["kind"], args: m[3].trim().split(/\s+/) }]);
  }
  // A block of "not path ..." lines, all of which must hold.
  for (const m of text.matchAll(/^\t@(\w+) \{\n([\s\S]*?)\n\t\}/gm)) {
    const clauses: Clause[] = [];
    for (const line of m[2].split("\n")) {
      const c = /^\s*(not )?(path|path_regexp) (.+)$/.exec(line);
      if (!c) throw new Error(`Unreadable matcher line: ${line}`);
      clauses.push({ negate: !!c[1], kind: c[2] as Clause["kind"], args: c[3].trim().split(/\s+/) });
    }
    matchers.set(m[1], clauses);
  }
  const blocks = [...text.matchAll(/^\trequest_body (@\w+) \{\n\t\tmax_size (\S+)\n\t\}/gm)].map((m) => ({
    matcher: m[1],
    bytes: bytesOf(m[2]),
  }));
  const bare = [...text.matchAll(/^\trequest_body\b(?! @\w+ \{)/gm)];
  const matches = (name: string, p: string) =>
    matchers.get(name.replace(/^@/, ""))!.every((c) => {
      // Caddy's path matcher ignores case; path_regexp does not.
      const hit =
        c.kind === "path"
          ? c.args.some((a) => a.toLowerCase() === p.toLowerCase())
          : c.args.some((a) => new RegExp(a).test(p));
      return c.negate ? !hit : hit;
    });
  return {
    blocks,
    bare: bare.length,
    forPath: (p: string) => blocks.filter((b) => matches(b.matcher, p)),
  };
}

describe("deploy/Caddyfile body limits", () => {
  const caddy = caddyLimits();

  it("has no request_body line without a matcher, which would stack on top of the others", () => {
    expect(caddy.blocks.length).toBeGreaterThanOrEqual(5);
    expect(caddy.bare).toBe(0);
  });

  // Caddy sizes are whole MiB, so a cap that is not a whole number of MiB (the security report, 4.3 MB) rounds up.
  it.each(LARGE_ROUTES)("caps $name at the size the app enforces, rounded up to a whole MiB at most", ({ sample, bytes }) => {
    const hits = caddy.forPath(sample);
    expect(hits).toHaveLength(1);
    expect(hits[0].bytes).toBeGreaterThanOrEqual(bytes);
    expect(hits[0].bytes - bytes).toBeLessThan(MIB);
  });

  it.each([
    "/api/tokens",
    "/api/projects",
    "/api/projects/abc123/files/read",
    "/api/projects/abc123/files/write/extra",
    "/api/builds/env",
    "/api/v1/projects",
    "/api/mcp",
    "/api/hooks/deploy/abc",
    "/api/webhooks/other",
    "/api/admin/security-reports",
    "/projects/abc123",
    "/",
  ])("gives %s exactly one limit, the small default, no larger than the framework buffer", (p) => {
    const hits = caddy.forPath(p);
    expect(hits).toHaveLength(1);
    expect(hits[0].bytes).toBeLessThanOrEqual(bufferedBytes());
  });
});

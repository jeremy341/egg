import { createHash } from "node:crypto";

/** A strong ETag for a response body: a quoted, shortened SHA-256 of its text. */
export function etagFor(body: string): string {
  return `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
}

/**
 * Whether an If-None-Match header names this ETag. The header may hold a list,
 * `*`, or weak (`W/`) forms; for a GET the weak comparison is the right one.
 */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const want = etag.replace(/^W\//, "");
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .some((t) => t === want);
}

/**
 * A public JSON response with an ETag. A request whose If-None-Match matches
 * gets an empty 304 and no body. Only for responses that are the same for every
 * visitor, since the result may be kept by shared caches.
 */
export function jsonWithEtag(req: Request | undefined, data: unknown, cacheControl: string): Response {
  const body = JSON.stringify(data);
  const etag = etagFor(body);
  const headers = { "Cache-Control": cacheControl, ETag: etag };
  if (etagMatches(req?.headers.get("if-none-match") ?? null, etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

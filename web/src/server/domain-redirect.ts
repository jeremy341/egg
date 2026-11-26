/**
 * The rules for redirecting a custom domain to another site. The redirect keeps the request's path and
 * query, so `old.example.com/a?b=1` goes to `https://new.example.com/a?b=1`. These functions only decide
 * the answer; they do not serve it. Nest maps a domain to a port with no API, so nothing here can yet
 * put a redirect in front of a domain.
 */

export const REDIRECT_STATUSES = [307, 308, 301, 302] as const;
export type RedirectStatus = (typeof REDIRECT_STATUSES)[number];

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type RedirectTargetResult = { ok: true; origin: string } | { ok: false; reason: string };

/**
 * A redirect target is a site origin only: scheme, host and an optional port. A path, query, fragment or
 * login is refused, because the request's own path and query are carried over. A target on the same
 * domain would loop, so it is refused too.
 */
export function parseRedirectTarget(raw: string, sourceDomain: string): RedirectTargetResult {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "Enter a full address such as https://new.example.com." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "The target must start with https:// or http://." };
  }
  if (url.username || url.password) return { ok: false, reason: "The target cannot contain a login." };
  // Anything after the host other than a lone "/" is a path, query or fragment: the request supplies those.
  const rest = text.replace(/^https?:\/\/[^/?#]+/i, "");
  if (rest !== "" && rest !== "/") return { ok: false, reason: "The target is a site address only. The request's own path and query are kept." };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!HOST.test(host)) return { ok: false, reason: "Enter a domain name such as new.example.com (not an IP address)." };
  if (host === sourceDomain.toLowerCase()) return { ok: false, reason: "A domain cannot redirect to itself." };
  return { ok: true, origin: `${url.protocol}//${url.host}` };
}

export function isRedirectStatus(value: unknown): value is RedirectStatus {
  return (REDIRECT_STATUSES as readonly unknown[]).includes(value);
}

/**
 * The response for one request: the chosen status, and a Location that keeps the path and query exactly
 * as the request sent them (no re-encoding, no added slash).
 */
export function redirectResponse(input: { origin: string; status: RedirectStatus; path: string; query: string }): { status: RedirectStatus; location: string } {
  const path = input.path === "" ? "/" : input.path;
  if (!path.startsWith("/")) throw new Error("The request path must start with /.");
  const query = input.query.replace(/^\?/, "");
  return { status: input.status, location: `${input.origin}${path}${query ? `?${query}` : ""}` };
}

/**
 * Parses a container image reference the way Docker does: [host/]repository[:tag][@sha256:digest].
 * A reference with no host is on Docker Hub. Only the syntax is checked here; whether the image exists
 * is for the registry to say.
 */

export type ImageRef = {
  /** Registry host with its port, lowercase. "docker.io" when the reference names no host. */
  host: string;
  /** Path inside the registry, such as "library/nginx" or "owner/app". */
  repository: string;
  tag: string | null;
  digest: string | null;
  /** True when the reference names no tag and no digest, or names the tag "latest". Such a tag can move. */
  movableTag: boolean;
};

export type ImageRefResult = { ok: true; ref: ImageRef } | { ok: false; reason: string };

export const IMAGE_REF_MAX = 255;
const COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const DEFAULT_HOST = "docker.io";

/** A registry host: a domain, localhost or an IPv4 address, with an optional port. No scheme and no path. */
export function registryHostError(raw: string): string | null {
  const host = raw.trim().toLowerCase();
  if (host.length === 0 || host.length > 261) return "Enter the registry host, such as ghcr.io.";
  const match = /^(.*?)(?::(\d{1,5}))?$/.exec(host);
  const name = match?.[1] ?? "";
  const port = match?.[2];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return "The registry port must be between 1 and 65535.";
  const ok = name === "localhost" || DOMAIN.test(name) || (IPV4.test(name) && name.split(".").every((n) => Number(n) <= 255));
  if (!ok) return "Enter the registry host only, such as ghcr.io or registry.example.com:5000 (no https:// and no path).";
  return null;
}

export function parseImageRef(raw: string): ImageRefResult {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, reason: "Enter an image, such as nginx:1.27." };
  if (text.length > IMAGE_REF_MAX) return { ok: false, reason: `An image reference is at most ${IMAGE_REF_MAX} characters.` };
  if (/\s/.test(text) || text.includes("://")) return { ok: false, reason: "An image reference has no spaces and no scheme. Enter something like nginx:1.27." };

  let name = text;
  let digest: string | null = null;
  const at = name.indexOf("@");
  if (at !== -1) {
    digest = name.slice(at + 1);
    name = name.slice(0, at);
    if (!DIGEST.test(digest)) return { ok: false, reason: "A digest must look like sha256 followed by 64 hex characters." };
  }

  let tag: string | null = null;
  const colon = name.lastIndexOf(":");
  if (colon > name.lastIndexOf("/")) {
    tag = name.slice(colon + 1);
    name = name.slice(0, colon);
    if (!TAG.test(tag)) return { ok: false, reason: "A tag may use letters, digits, _ . and - (up to 128 characters), and cannot start with . or -." };
  }

  const parts = name.split("/");
  let host = DEFAULT_HOST;
  if (parts.length > 1 && (parts[0].includes(".") || parts[0].includes(":") || parts[0] === "localhost")) {
    host = (parts.shift() ?? "").toLowerCase();
    const hostError = registryHostError(host);
    if (hostError) return { ok: false, reason: hostError };
  }
  if (parts.length === 0 || parts.some((p) => !COMPONENT.test(p))) {
    return { ok: false, reason: "The repository name may use lowercase letters, digits, and single . _ or - between them, such as owner/app." };
  }
  const repository = host === DEFAULT_HOST && parts.length === 1 ? `library/${parts[0]}` : parts.join("/");
  return {
    ok: true,
    ref: { host, repository, tag, digest, movableTag: digest === null && (tag === null || tag === "latest") },
  };
}

/** The registry host an image reference points at. Throws on a reference that does not parse. */
export function registryHostOf(raw: string): string {
  const result = parseImageRef(raw);
  if (!result.ok) throw new Error(result.reason);
  return result.ref.host;
}

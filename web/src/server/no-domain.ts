import { isIP } from "node:net";

/**
 * A trial host is a name someone can use to reach an Egg instance without
 * owning a domain: `localhost`, a loopback address, or a wildcard-DNS name
 * (nip.io / sslip.io) that points back at loopback. Those names work for a
 * local trial, but they cannot back real HTTPS certificates, custom domains
 * or a public status page, so the UI needs to know when it is looking at one.
 *
 * Everything here is pure: a Host header value goes in, a classification comes
 * out. No environment, config, database or DNS lookup is involved.
 */

/** Features that need a public, DNS-controlled hostname and so cannot work on a trial host. */
export const TRIAL_UNAVAILABLE_FEATURES = Object.freeze([
  "httpsCerts",
  "customDomains",
  "publicStatus",
] as const);

export type TrialUnavailableFeature = (typeof TRIAL_UNAVAILABLE_FEATURES)[number];

export type TrialHostInfo = {
  /** True when the given host is a recognised local trial hostname. */
  isTrialHost: boolean;
  /** The features a trial host cannot offer; empty for any other host. */
  unavailable: readonly TrialUnavailableFeature[];
  /** The same answer keyed by feature, for callers that prefer boolean flags. */
  unavailableFeatures: Record<TrialUnavailableFeature, boolean>;
};

// Frozen so callers cannot mutate the shared answer and change a later call.
const NOT_TRIAL: TrialHostInfo = Object.freeze({
  isTrialHost: false,
  unavailable: Object.freeze([]),
  unavailableFeatures: Object.freeze({ httpsCerts: false, customDomains: false, publicStatus: false }),
});

const IS_TRIAL: TrialHostInfo = Object.freeze({
  isTrialHost: true,
  unavailable: TRIAL_UNAVAILABLE_FEATURES,
  unavailableFeatures: Object.freeze({ httpsCerts: true, customDomains: true, publicStatus: true }),
});

const MAX_HOST_LENGTH = 253;
const WILDCARD_SUFFIXES = ["nip.io", "sslip.io"] as const;

/**
 * Turn a Host header value (a bare hostname, optionally with a port, or a
 * bracketed IPv6 literal) into the canonical lowercase hostname. Returns null
 * for anything that is not a plain host: a URL, a path, userinfo, whitespace,
 * a bad port or a malformed DNS name. Validation is deliberately strict so a
 * crafted value such as `localhost.evil.com` can never be read as local.
 */
export function normalizeHost(input: string): string | null {
  if (typeof input !== "string") return null;
  let h = input.trim().toLowerCase();
  if (!h || h.length > MAX_HOST_LENGTH || /[\s/?#@\\]/.test(h)) return null;

  // Host headers carry IPv6 in brackets; allow an optional numeric port after them.
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end < 0) return null;
    const inner = h.slice(1, end);
    const tail = h.slice(end + 1);
    if (tail && !/^:\d{1,5}$/.test(tail)) return null;
    return isIP(inner) === 6 ? inner : null;
  }
  // Callers may also hand us a bare IPv6 literal rather than a Host header.
  if (h.includes(":") && isIP(h) === 6) return h;

  h = h.replace(/\.$/, ""); // absolute DNS form: "localhost." is "localhost"
  const colon = h.lastIndexOf(":");
  if (colon !== -1) {
    if (!/^\d{1,5}$/.test(h.slice(colon + 1))) return null;
    h = h.slice(0, colon);
  }
  if (!h || h.length > MAX_HOST_LENGTH || !/^[a-z0-9._-]+$/.test(h)) return null;
  if (h.startsWith(".") || h.endsWith(".") || h.includes("..")) return null;
  return h;
}

/** Any real 127.x.x.x address or ::1 is loopback, matching config.isLoopbackHost. */
function isLoopbackAddress(host: string): boolean {
  if (host === "::1") return true;
  if (isIP(host) !== 4 || !host.startsWith("127.")) return false;
  return host.split(".").every((part) => {
    const n = Number(part);
    return /^\d{1,3}$/.test(part) && n >= 0 && n <= 255 && String(n) === part;
  });
}

/**
 * The label a wildcard service encodes before its suffix. nip.io and sslip.io
 * both accept dotted (`127.0.0.1`) and dashed (`127-0-0-1`) IPv4 forms, and
 * both resolve `localhost` to loopback. Anything else is a real domain that
 * happens to end in the same suffix and is not a local trial name.
 */
function isLoopbackWildcard(label: string): boolean {
  if (label === "localhost") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(label)) return isLoopbackAddress(label);
  if (/^127(?:-\d{1,3}){3}$/.test(label)) return isLoopbackAddress(label.replace(/-/g, "."));
  return false;
}

/** True only for a hostname that resolves a local trial instance without a real domain. */
export function isTrialHost(host: string): boolean {
  const h = normalizeHost(host);
  if (!h) return false;
  if (h === "localhost" || isLoopbackAddress(h)) return true;
  for (const suffix of WILDCARD_SUFFIXES) {
    if (!h.endsWith(`.${suffix}`)) continue;
    const label = h.slice(0, -(suffix.length + 1));
    if (isLoopbackWildcard(label)) return true;
  }
  return false;
}

/** The fixed set of features that a local trial host cannot offer. */
export function trialUnavailableFeatures(): readonly TrialUnavailableFeature[] {
  return TRIAL_UNAVAILABLE_FEATURES;
}

/** Classify a request host, including the features its trial status rules out. */
export function inspectTrialHost(host: string): TrialHostInfo {
  return isTrialHost(host) ? IS_TRIAL : NOT_TRIAL;
}

/** Alias for callers that describe this check as "no domain". */
export const noDomainInfo = inspectTrialHost;

/** Alias for callers that prefer a "detect" verb. */
export const detectTrialHost = inspectTrialHost;

/**
 * Turns the raw message of a failed container read (SSH timeouts, refused
 * connections, a rejected key) into one plain sentence, and keeps the raw
 * text for a details disclosure. The patterns match the messages produced in
 * server/ssh/connection.ts and the routes that read the container.
 */
export const CONNECTION_SUMMARY = "We can't reach your container right now";

const CONNECTION_PATTERNS = [
  "timed out connecting",
  "could not reach",
  "nest rejected the key",
  "host key of",
  "could not read the service",
  "could not read the container",
  "ssh error",
  "econnrefused",
  "enotfound",
  "ehostunreach",
  "econnreset",
];

export type ConnectionErrorView =
  | { connection: true; summary: string; detail: string }
  | { connection: false; summary: string; detail: null };

export function describeConnectionError(message: string): ConnectionErrorView {
  const lower = message.toLowerCase();
  if (CONNECTION_PATTERNS.some((p) => lower.includes(p))) {
    return { connection: true, summary: CONNECTION_SUMMARY, detail: message };
  }
  return { connection: false, summary: message, detail: null };
}

const DOMAIN_FALLBACK = "DNS does not point at your server yet. Press Check to see what it points at.";

/** Why a domain needs attention: the last check's reason, or the plain default. */
export function domainCause(reason: string | null | undefined): string {
  const text = reason?.trim();
  return text ? text : DOMAIN_FALLBACK;
}

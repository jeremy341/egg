import { createHash } from "node:crypto";

/**
 * Fingerprints for grouping JavaScript errors. Two errors belong to one group
 * when their message and top stack frame match once the numbers, ids, hashes
 * and URL query strings are taken out. The top frame is the file the error
 * came from; the line number is left out because it moves with every edit.
 */

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_ID = /\b[0-9a-f]{8,}\b/gi;
/** Long tokens with both letters and digits: ids, tokens, hashed names. */
const MIXED_TOKEN = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{12,}\b/g;
const NUMBER = /\b\d+(?:\.\d+)?\b/g;
/** A URL's query string and fragment: they carry user data and change per request. */
const URL_TAIL = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]*)[?#][^\s]*/gi;

/** Largest stored or compared text. Longer messages are cut before fingerprinting. */
const MAX_TEXT = 300;

export function stripQuery(text: string): string {
  return text.replace(URL_TAIL, "$1");
}

/** Message for grouping: no query strings, ids or numbers, whitespace collapsed. */
export function normalizeMessage(message: string): string {
  return stripQuery(message)
    .replace(/\s+/g, " ")
    .trim()
    .replace(UUID, "<id>")
    .replace(HEX_ID, "<id>")
    .replace(MIXED_TOKEN, "<id>")
    .replace(NUMBER, "<n>")
    .slice(0, MAX_TEXT);
}

/** File for grouping: no query string or fragment, no line or column, no hashed bundle name. */
export function normalizeFile(file: string | null | undefined): string {
  if (!file) return "";
  return stripQuery(file)
    .replace(/:\d+(?::\d+)?$/, "")
    .replace(HEX_ID, "<id>")
    .replace(MIXED_TOKEN, "<id>")
    .slice(0, MAX_TEXT);
}

/** A 16-character hex fingerprint of the normalized message and top frame. */
export function fingerprintOf(message: string, file: string | null | undefined): string {
  return createHash("sha256")
    .update(`${normalizeMessage(message)}\n${normalizeFile(file)}`)
    .digest("hex")
    .slice(0, 16);
}

/** The message as shown in a list: query strings removed, cut to a readable length. */
export function displayMessage(message: string): string {
  return stripQuery(message).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

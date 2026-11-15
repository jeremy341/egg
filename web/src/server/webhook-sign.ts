import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signing for outbound webhooks. The receiver can prove a request came from
 * this app and was not changed on the way.
 *
 * Header: `X-NestDeploy-Signature: t=<unix seconds>,v1=<hex>` where `v1` is
 * HMAC-SHA256, keyed with the webhook's secret, over `"<t>.<body>"`. The
 * timestamp is inside the signed text, so an old request cannot be replayed
 * with a fresh timestamp.
 */

export const SIGNATURE_HEADER = "X-NestDeploy-Signature";
export const SECRET_PREFIX = "whsec_";
/** How old a signature may be before `verifyWebhookSignature` refuses it. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** A new random secret: 256 bits, URL-safe, with a recognisable prefix. */
export function newWebhookSecret(): string {
  return SECRET_PREFIX + randomBytes(32).toString("base64url");
}

function mac(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function signWebhook(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${mac(secret, timestamp, body)}`;
}

/**
 * What a receiver does, kept here so the tests and the docs agree. Refuses a
 * malformed header, a wrong signature and a timestamp outside the tolerance.
 */
export function verifyWebhookSignature(secret: string, header: string, body: string, nowSeconds: number): boolean {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!m) return false;
  const timestamp = Number(m[1]);
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(mac(secret, timestamp, body), "hex");
  const given = Buffer.from(m[2], "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

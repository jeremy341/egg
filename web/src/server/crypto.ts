import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { config } from "@/server/config";

/**
 * Sealing for secrets stored in the database (SSH private keys, env vars).
 * AES-256-GCM with a key derived from APP_SECRET. Each value gets its own
 * random IV, and a context string is bound in as additional authenticated
 * data so a sealed value cannot be moved to a different row or purpose.
 */

const VERSION = "v1";

function key(): Buffer {
  const derived = hkdfSync(
    "sha256",
    Buffer.from(config().APP_SECRET, "utf8"),
    Buffer.from("nest-deploy-salt"),
    Buffer.from("nest-deploy secrets v1"),
    32
  );
  return Buffer.from(derived);
}

export function seal(plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function open(sealed: string, context: string): string {
  const [version, iv, tag, ct] = sealed.split(".");
  // An empty ciphertext base64-decodes to the empty string, which is the
  // legitimate sealing of "" (GCM appends no padding); only a missing
  // segment means the value has the wrong shape.
  if (version !== VERSION || !iv || !tag || ct === undefined) {
    throw new Error("Unrecognised sealed value");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ct, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function newId(): string {
  return randomUUID();
}

/** A URL-safe random token, for session cookies and OAuth state. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * A keyed digest (HMAC-SHA256) for correlating a value without storing it, such
 * as a rate-limit source. The key is derived from APP_SECRET with a purpose
 * label, so the digest cannot be recomputed from the database alone and one
 * purpose's digests never match another's.
 */
export function keyedDigestHex(purpose: string, value: string): string {
  const subkey = hkdfSync(
    "sha256",
    Buffer.from(config().APP_SECRET, "utf8"),
    Buffer.from("nest-deploy-salt"),
    Buffer.from(`nest-deploy digest ${purpose}`),
    32
  );
  return createHmac("sha256", Buffer.from(subkey)).update(value, "utf8").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

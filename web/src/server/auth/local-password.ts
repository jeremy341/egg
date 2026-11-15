import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_BYTES = 64;
const MAXMEM = 128 * 1024 * 1024;
export const LOCAL_PASSWORD_MIN_CHARS = 12;
export const LOCAL_PASSWORD_MAX_BYTES = 256;

/** Return a user-facing validation error, or null for a usable password. */
export function localPasswordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "Enter a password.";
  if (Array.from(password).length < LOCAL_PASSWORD_MIN_CHARS) {
    return `Use at least ${LOCAL_PASSWORD_MIN_CHARS} characters.`;
  }
  if (Buffer.byteLength(password, "utf8") > LOCAL_PASSWORD_MAX_BYTES) {
    return `Use no more than ${LOCAL_PASSWORD_MAX_BYTES} bytes.`;
  }
  return null;
}

async function derive(password: string, salt: Buffer, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_BYTES, { N: n, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAXMEM }, (err, key) => {
      if (err) reject(err);
      else resolve(Buffer.from(key));
    });
  });
}

/** Store only this slow, salted verifier; never persist the local password itself. */
export async function hashLocalPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT_N);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyLocalPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }
  if (salt.length !== 16 || expected.length !== KEY_BYTES) return false;
  const actual = await derive(password, salt, n);
  return timingSafeEqual(actual, expected);
}

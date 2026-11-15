import { createHmac, timingSafeEqual } from "node:crypto";

/** Compare a submitted local sign-in key without leaking a prefix match by timing. */
export function matchesLocalSecret(expected: string, supplied: string, key: string): boolean {
  const expectedDigest = createHmac("sha256", key).update(expected).digest();
  const suppliedDigest = createHmac("sha256", key).update(supplied).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

import { createHash } from "node:crypto";
import { utils } from "ssh2";

export type GeneratedKey = {
  /** One line, ready to paste into the Nest dashboard's SSH Keys page. */
  publicKey: string;
  /** OpenSSH private key. Seal it before storing. */
  privateKey: string;
  /** SHA256:... fingerprint of the public key. */
  fingerprint: string;
};

/** Fingerprint in the same format `ssh-keygen -l` prints. */
export function fingerprintOfBlob(blob: Buffer): string {
  return `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;
}

export function fingerprintOfPublicKey(publicKeyLine: string): string {
  const parsed = utils.parseKey(publicKeyLine);
  if (parsed instanceof Error) throw parsed;
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  return fingerprintOfBlob(key.getPublicSSH());
}

/**
 * ssh2 drops leading zero bytes from the raw ed25519 public key, so about one key in 256
 * comes out as a 31-byte key that neither ssh2 nor OpenSSH can read. Draw again until the
 * pair parses.
 */
export function generateEd25519Pair(comment?: string): { public: string; private: string } {
  for (;;) {
    const pair = utils.generateKeyPairSync("ed25519", comment ? { comment } : undefined);
    if (!(utils.parseKey(pair.public) instanceof Error) && !(utils.parseKey(pair.private) instanceof Error)) return pair;
  }
}

/**
 * A dedicated ed25519 key for exactly one purpose: one Nest server login, one
 * repository deploy key, or one personal key. It is never reused for another
 * user or service, so removing it where it was installed revokes its access.
 */
export function generateServerKey(comment: string): GeneratedKey {
  const pair = generateEd25519Pair(comment);
  return {
    publicKey: pair.public.trim(),
    privateKey: pair.private,
    fingerprint: fingerprintOfPublicKey(pair.public),
  };
}

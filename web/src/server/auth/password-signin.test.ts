import { describe, expect, it } from "vitest";
import {
  generateRecoveryKey,
  hasOtherSignIn,
  normalizeEmail,
  normalizeRecoveryKey,
  prepareSetup,
  setupTicketValid,
  type SignInEnvironment,
} from "@/server/auth/password-signin";

const env = (over: Partial<SignInEnvironment> = {}): SignInEnvironment => ({
  hackClubConfigured: true,
  devLogin: false,
  production: false,
  localMode: false,
  ...over,
});

describe("lockout rule: another way to sign in", () => {
  it("lets a Hack Club account turn the password off while Hack Club sign-in is set up", () => {
    expect(hasOtherSignIn({ hackClubId: "ident!abc" }, env())).toBe(true);
  });

  it("refuses when Hack Club sign-in is not set up on this installation", () => {
    expect(hasOtherSignIn({ hackClubId: "ident!abc" }, env({ hackClubConfigured: false }))).toBe(false);
  });

  it("lets a development account turn it off only with the development sign-in available", () => {
    const dev = { hackClubId: "dev:sam" };
    expect(hasOtherSignIn(dev, env({ devLogin: true }))).toBe(true);
    expect(hasOtherSignIn(dev, env({ devLogin: false }))).toBe(false);
    expect(hasOtherSignIn(dev, env({ devLogin: true, production: true }))).toBe(false);
    // Local mode puts a password in front of the development sign-in.
    expect(hasOtherSignIn(dev, env({ devLogin: true, localMode: true }))).toBe(false);
    // Hack Club being set up does not help an account that is not a Hack Club one.
    expect(hasOtherSignIn(dev, env({ hackClubConfigured: true, devLogin: false }))).toBe(false);
  });

  it("never lets the local-mode owner turn it off", () => {
    expect(hasOtherSignIn({ hackClubId: "local:owner" }, env({ devLogin: true }))).toBe(false);
  });
});

describe("recovery key", () => {
  it("is 160 random bits as eight groups of four, different every time", () => {
    const keys = new Set(Array.from({ length: 50 }, generateRecoveryKey));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(key).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
  });

  it("matches however it was typed", () => {
    const key = generateRecoveryKey();
    expect(normalizeRecoveryKey(key.toLowerCase().replaceAll("-", " "))).toBe(normalizeRecoveryKey(key));
    expect(normalizeRecoveryKey(key)).toHaveLength(32);
  });
});

describe("setup ticket", () => {
  it("accepts the key this server issued for this user, once, within 15 minutes", () => {
    const now = 1_000_000;
    const setup = prepareSetup("user-1", now);
    expect(setupTicketValid("user-1", setup.recoveryKey, setup.expiresAt, setup.ticket, now + 1000)).toBe(true);
    expect(setupTicketValid("user-1", setup.recoveryKey, setup.expiresAt, setup.ticket, setup.expiresAt + 1)).toBe(false);
  });

  it("rejects a key the server did not issue, another user and a stretched expiry", () => {
    const now = 1_000_000;
    const setup = prepareSetup("user-1", now);
    expect(setupTicketValid("user-1", generateRecoveryKey(), setup.expiresAt, setup.ticket, now)).toBe(false);
    expect(setupTicketValid("user-2", setup.recoveryKey, setup.expiresAt, setup.ticket, now)).toBe(false);
    expect(setupTicketValid("user-1", setup.recoveryKey, setup.expiresAt + 3_600_000, setup.ticket, now)).toBe(false);
    expect(setupTicketValid("user-1", setup.recoveryKey, setup.expiresAt, "", now)).toBe(false);
  });
});

describe("email", () => {
  it("is trimmed and lower-cased, and anything else is empty", () => {
    expect(normalizeEmail("  Sam@Example.COM ")).toBe("sam@example.com");
    expect(normalizeEmail(null)).toBe("");
  });
});

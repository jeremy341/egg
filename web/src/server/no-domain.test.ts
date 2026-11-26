import { describe, expect, it } from "vitest";
import {
  TRIAL_UNAVAILABLE_FEATURES,
  detectTrialHost,
  inspectTrialHost,
  isTrialHost,
  noDomainInfo,
  normalizeHost,
  trialUnavailableFeatures,
} from "@/server/no-domain";

describe("normalizeHost", () => {
  it.each([
    ["localhost:3000", "localhost"],
    ["  LOCALHOST.  ", "localhost"],
    ["127.0.0.1.nip.io:8080", "127.0.0.1.nip.io"],
    ["127-0-0-1.SSLIP.IO.", "127-0-0-1.sslip.io"],
    ["[::1]:3000", "::1"],
    ["::1", "::1"],
    ["127.0.0.1", "127.0.0.1"],
  ])("canonicalises %s to %s", (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "https://localhost",
    "localhost/path",
    "127.0.0.1.nip.io?x=1",
    "user@localhost",
    "localhost:abc",
    "localhost:",
    "[::1",
    "[bad]:3000",
    ".localhost",
    "localhost..",
    "local host",
    "localhost\\evil",
  ])("rejects %s", (input) => {
    expect(normalizeHost(input)).toBeNull();
  });
});

describe("isTrialHost", () => {
  it.each([
    "localhost",
    "LOCALHOST",
    "localhost.",
    " localhost:3000 ",
    "127.0.0.1",
    "127.1.2.3",
    "::1",
    "[::1]:3000",
    "127.0.0.1.nip.io",
    "127-0-0-1.nip.io",
    "localhost.nip.io",
    "127.0.0.1.sslip.io",
    "127-0-0-1.sslip.io",
    "127.2.3.4.sslip.io",
    "localhost.sslip.io",
    "127.0.0.1.SSLIP.IO:3000",
  ])("is true for %s", (host) => {
    expect(isTrialHost(host)).toBe(true);
  });

  it.each([
    "example.com",
    "app.hackclub.app",
    "0.0.0.0",
    "192.168.1.20",
    "127.999.0.1",
    "127.0.0.01",
    "localhost.evil.com",
    "127.0.0.1.nip.io.evil.com",
    "evil.nip.io",
    "evil.127.0.0.1.nip.io",
    "127.0.0.1.nip.io.evil.com",
    "myapp.sslip.io",
    "https://localhost:3000",
    "localhost/admin",
    "user@localhost",
    "",
  ])("is false for %s", (host) => {
    expect(isTrialHost(host)).toBe(false);
  });

  it("does not confuse a wildcard suffix with a plain public domain", () => {
    expect(isTrialHost("127.0.0.1.notnip.io")).toBe(false);
    expect(isTrialHost("127.0.0.1.sslip.io.evil.test")).toBe(false);
  });
});

describe("inspectTrialHost", () => {
  it("reports every unavailable feature for a trial host", () => {
    expect(inspectTrialHost("localhost:3000")).toEqual({
      isTrialHost: true,
      unavailable: ["httpsCerts", "customDomains", "publicStatus"],
      unavailableFeatures: { httpsCerts: true, customDomains: true, publicStatus: true },
    });
  });

  it("reports nothing unavailable for a public host", () => {
    expect(inspectTrialHost("app.example.com")).toEqual({
      isTrialHost: false,
      unavailable: [],
      unavailableFeatures: { httpsCerts: false, customDomains: false, publicStatus: false },
    });
  });

  it("agrees with isTrialHost for a wildcard trial hostname", () => {
    const host = "127.0.0.1.nip.io";
    expect(inspectTrialHost(host).isTrialHost).toBe(isTrialHost(host));
  });

  it("exposes the same classifier under its alternate names", () => {
    const host = "127-0-0-1.sslip.io";
    expect(detectTrialHost(host)).toEqual(inspectTrialHost(host));
    expect(noDomainInfo(host)).toEqual(inspectTrialHost(host));
  });
});

describe("trialUnavailableFeatures", () => {
  it("is the fixed list of features a trial host rules out", () => {
    expect(trialUnavailableFeatures()).toEqual(["httpsCerts", "customDomains", "publicStatus"]);
    expect(trialUnavailableFeatures()).toBe(TRIAL_UNAVAILABLE_FEATURES);
  });

  it("cannot be changed by a caller", () => {
    expect(Object.isFrozen(TRIAL_UNAVAILABLE_FEATURES)).toBe(true);
    expect(() => {
      (TRIAL_UNAVAILABLE_FEATURES as unknown as string[]).push("somethingElse");
    }).toThrow();
    expect(trialUnavailableFeatures()).toEqual(["httpsCerts", "customDomains", "publicStatus"]);
  });

  it("returns a result a caller cannot corrupt for later calls", () => {
    const first = inspectTrialHost("localhost");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.unavailable)).toBe(true);
    expect(() => {
      (first.unavailableFeatures as Record<string, boolean>).httpsCerts = false;
    }).toThrow();
    expect(inspectTrialHost("localhost")).toEqual(first);
  });
});

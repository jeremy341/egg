import { describe, expect, it } from "vitest";
import {
  checkDomainPolicy,
  isNestName,
  isPublicDomain,
  MESSAGES,
  ownedParentOf,
  RESERVED_NAMES,
} from "@/server/domain-policy";

const USER = "sam-r";
const RESERVED = MESSAGES.reserved;
const NOT_YOURS = "Only your Nest name, sam-r.hackclub.app, can be used under hackclub.app.";

describe("reserved list", () => {
  it("holds Nest's names and Egg's additions", () => {
    for (const n of ["admin", "api", "dashboard", "docs", "help", "status", "www", "umami", "www3"]) {
      expect(RESERVED_NAMES.has(n), n).toBe(true);
    }
    for (const n of ["egg", "nest", "hackclub", "hack-club", "nest-deploy", "egg-deploy", "loadout"]) {
      expect(RESERVED_NAMES.has(n), n).toBe(true);
    }
    expect(RESERVED_NAMES.has("sam-r")).toBe(false);
  });
});

describe("checkDomainPolicy", () => {
  const refused: [string, string, string][] = [
    ["a bare reserved word", "admin", RESERVED],
    ["a bare Egg word", "egg", RESERVED],
    ["a reserved name under hackclub.app", "admin.hackclub.app", RESERVED],
    ["nest under hackclub.app", "nest.hackclub.app", RESERVED],
    ["www under hackclub.app", "www.hackclub.app", RESERVED],
    ["hackclub.app itself", "hackclub.app", RESERVED],
    ["a reserved name under hackclub.com", "status.hackclub.com", RESERVED],
    ["a reserved name deep under hackclub.dev", "x.admin.hackclub.dev", RESERVED],
    ["a reserved name under localhost", "admin.localhost", RESERVED],
    ["another person's Nest name", "kim.hackclub.app", NOT_YOURS],
    ["a subdomain of another person's Nest name", "app.kim.hackclub.app", NOT_YOURS],
    ["a name that only ends like yours", "evilsam-r.hackclub.app", NOT_YOURS],
    ["yours under a longer suffix", "sam-r.hackclub.app.evil.com.hackclub.app", NOT_YOURS],
    ["an IPv4 address", "1.2.3.4", MESSAGES.notPublic],
    ["localhost (a reserved word)", "localhost", RESERVED],
    ["a name under localhost", "mything.localhost", MESSAGES.notPublic],
    ["a .local name", "printer.local", MESSAGES.notPublic],
    ["a .internal name", "db.internal", MESSAGES.notPublic],
    ["a .home.arpa name", "tv.home.arpa", MESSAGES.notPublic],
  ];
  for (const [label, domain, message] of refused) {
    it(`refuses ${label}`, () => {
      const r = checkDomainPolicy(domain, USER);
      expect(r.allowed, domain).toBe(false);
      if (!r.allowed) expect(r.message).toBe(message);
    });
  }

  const allowed: [string, string][] = [
    ["your own Nest name", "sam-r.hackclub.app"],
    ["your Nest name in capitals", "Sam-R.HackClub.app"],
    ["a subdomain of your Nest name", "poorup.sam-r.hackclub.app"],
    ["a reserved word as a subdomain of your own name", "api.sam-r.hackclub.app"],
    ["a normal custom domain", "app.example.com"],
    ["a custom domain with a reserved label", "admin.example.com"],
    ["a custom domain that looks like a Nest word", "nest.example.org"],
    ["a subdomain of a custom domain", "api.example.com"],
  ];
  for (const [label, domain] of allowed) {
    it(`allows ${label}`, () => {
      expect(checkDomainPolicy(domain, USER), domain).toEqual({ allowed: true });
    });
  }

  it("says which rule refused it", () => {
    expect(checkDomainPolicy("admin.hackclub.app", USER)).toMatchObject({ code: "reserved" });
    expect(checkDomainPolicy("kim.hackclub.app", USER)).toMatchObject({ code: "nest-name" });
    expect(checkDomainPolicy("10.0.0.1", USER)).toMatchObject({ code: "not-public" });
  });
});

describe("isPublicDomain", () => {
  it("matches Nest's rules", () => {
    expect(isPublicDomain("example.com")).toBe(true);
    for (const bad of ["", "localhost", "a.localhost", "a.local", "a.internal", "a.home.arpa", "127.0.0.1", "::1", "fe80::1"]) {
      expect(isPublicDomain(bad), bad).toBe(false);
    }
  });
});

describe("isNestName", () => {
  it("covers the account's own name and anything under it", () => {
    expect(isNestName("sam-r.hackclub.app", USER)).toBe(true);
    expect(isNestName("a.b.sam-r.hackclub.app", USER)).toBe(true);
    expect(isNestName("kim.hackclub.app", USER)).toBe(false);
    expect(isNestName("sam-r.hackclub.app.example.com", USER)).toBe(false);
    expect(isNestName("example.com", USER)).toBe(false);
  });
});

describe("ownedParentOf", () => {
  const owned = [
    { domain: "example.com", status: "valid" },
    { domain: "api.example.com", status: "valid" },
    { domain: "waiting.org", status: "pending" },
    { domain: "gone.net", status: "invalid" },
  ];
  it("finds the nearest verified parent", () => {
    expect(ownedParentOf("app.example.com", owned)?.domain).toBe("example.com");
    expect(ownedParentOf("v2.api.example.com", owned)?.domain).toBe("api.example.com");
  });
  it("ignores the domain itself, unverified parents, and look-alikes", () => {
    expect(ownedParentOf("example.com", owned)).toBeNull();
    expect(ownedParentOf("app.waiting.org", owned)).toBeNull();
    expect(ownedParentOf("app.gone.net", owned)).toBeNull();
    expect(ownedParentOf("badexample.com", owned)).toBeNull();
    expect(ownedParentOf("example.com.evil.io", owned)).toBeNull();
  });
});

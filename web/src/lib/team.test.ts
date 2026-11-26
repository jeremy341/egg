import { describe, expect, it } from "vitest";
import {
  INVITE_DAYS,
  ROLE_LABEL,
  ROLE_NOTE,
  expiryText,
  inviteLink,
  isOpenInvitation,
  tokenFromHash,
} from "./team";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();
const HOUR = 3_600_000;

describe("role text", () => {
  it("names and describes all three roles", () => {
    for (const role of ["viewer", "developer", "owner"] as const) {
      expect(ROLE_LABEL[role]).toMatch(/^[A-Z]/);
      expect(ROLE_NOTE[role].endsWith(".")).toBe(true);
    }
  });

  it("does not promise a viewer anything that changes the project", () => {
    expect(ROLE_NOTE.viewer).not.toMatch(/\b(deploy|redeploy|cancel|roll back|restart|change|edit|delete|use)\b/i);
  });

  it("keeps the owner-only powers off the developer", () => {
    expect(ROLE_NOTE.developer).not.toMatch(/settings|environment|terminal|files|delete/i);
    expect(ROLE_NOTE.owner).toMatch(/settings/);
  });

  it("matches the server's one-week invitation lifetime", () => {
    expect(INVITE_DAYS).toBe(7);
  });
});

describe("invitation expiry", () => {
  it("counts days, then hours, then under an hour", () => {
    expect(expiryText(at(6 * 24 * HOUR + HOUR), NOW)).toBe("Expires in 6 days");
    // An invitation made a moment ago lasts the full week, and says so.
    expect(expiryText(at(INVITE_DAYS * 24 * HOUR - 50), NOW)).toBe("Expires in 7 days");
    expect(expiryText(at(47 * HOUR), NOW)).toBe("Expires in 47 hours");
    expect(expiryText(at(HOUR), NOW)).toBe("Expires in 1 hour");
    expect(expiryText(at(HOUR / 2), NOW)).toBe("Expires in under an hour");
  });

  it("says Expired at and after the moment, and for a date it cannot read", () => {
    expect(expiryText(at(0), NOW)).toBe("Expired");
    expect(expiryText(at(-HOUR), NOW)).toBe("Expired");
    expect(expiryText("not a date", NOW)).toBe("Expired");
  });

  it("calls an invitation open only if it is unused and not expired", () => {
    expect(isOpenInvitation({ acceptedAt: null, expiresAt: at(HOUR) }, NOW)).toBe(true);
    expect(isOpenInvitation({ acceptedAt: null, expiresAt: at(-HOUR) }, NOW)).toBe(false);
    expect(isOpenInvitation({ acceptedAt: at(-HOUR), expiresAt: at(HOUR) }, NOW)).toBe(false);
  });
});

describe("the invitation link", () => {
  it("puts the token in the fragment so it is never sent to a server", () => {
    const link = inviteLink("https://egg.example/", "abc_DEF-123");
    expect(link).toBe("https://egg.example/invite#token=abc_DEF-123");
    expect(new URL(link).search).toBe("");
  });

  it("encodes a token that has characters a URL would misread", () => {
    const token = "a b&c=d#e";
    const link = inviteLink("http://localhost:3000", token);
    expect(tokenFromHash(new URL(link).hash)).toBe(token);
  });

  it("reads the token back, and nothing from a hash that has none", () => {
    expect(tokenFromHash("#token=xyz")).toBe("xyz");
    expect(tokenFromHash("token=xyz")).toBe("xyz");
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash("#other=1")).toBeNull();
    expect(tokenFromHash("#token=")).toBeNull();
  });

  it("refuses a token longer than the server accepts", () => {
    expect(tokenFromHash(`#token=${"a".repeat(257)}`)).toBeNull();
    expect(tokenFromHash(`#token=${"a".repeat(256)}`)).toHaveLength(256);
  });
});

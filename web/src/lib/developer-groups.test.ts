import { describe, expect, it } from "vitest";
import { EXPIRING_SOON_DAYS, groupTokens, isExpiringSoon } from "@/lib/developer-groups";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-05T12:00:00Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();

const tok = (id: string, over: { revokedAt?: string | null; expiresAt?: string } = {}) => ({
  id,
  revokedAt: null as string | null,
  expiresAt: at(90 * DAY),
  ...over,
});

const ids = (list: { id: string }[]) => list.map((t) => t.id);
const activeIds = (g: ReturnType<typeof groupTokens<ReturnType<typeof tok>>>) => g.active.map((e) => e.token.id);

describe("groupTokens", () => {
  it("returns empty groups for an empty list", () => {
    expect(groupTokens([], NOW)).toEqual({ active: [], expiringSoon: 0, expired: [], revoked: [] });
  });

  it("puts every token in Active when all are active, soonest expiry first", () => {
    const g = groupTokens(
      [
        tok("in-90", { expiresAt: at(90 * DAY) }),
        tok("in-30", { expiresAt: at(30 * DAY) }),
        tok("in-365", { expiresAt: at(365 * DAY) }),
        tok("in-2", { expiresAt: at(2 * DAY) }),
      ],
      NOW
    );
    expect(activeIds(g)).toEqual(["in-2", "in-30", "in-90", "in-365"]);
    expect(g.active.map((e) => e.expiringSoon)).toEqual([true, false, false, false]);
    expect(g.expiringSoon).toBe(1);
    expect(g.expired).toEqual([]);
    expect(g.revoked).toEqual([]);
  });

  it("keeps the given order for active tokens that expire at the same moment", () => {
    const same = at(30 * DAY);
    const g = groupTokens([tok("b", { expiresAt: same }), tok("a", { expiresAt: same })], NOW);
    expect(activeIds(g)).toEqual(["b", "a"]);
  });

  it("splits mixed statuses into Active, Expired and Revoked, and keeps every token", () => {
    const input = [
      tok("revoked-old", { revokedAt: at(-20 * DAY) }),
      tok("expired-long-ago", { expiresAt: at(-30 * DAY) }),
      tok("active-later", { expiresAt: at(60 * DAY) }),
      tok("revoked-new", { revokedAt: at(-1 * DAY) }),
      tok("expired-yesterday", { expiresAt: at(-1 * DAY) }),
      tok("active-soon", { expiresAt: at(3 * DAY) }),
    ];
    const g = groupTokens(input, NOW);
    expect(activeIds(g)).toEqual(["active-soon", "active-later"]);
    expect(g.expiringSoon).toBe(1);
    // Most recent first: what just stopped working is what someone looks for.
    expect(ids(g.expired)).toEqual(["expired-yesterday", "expired-long-ago"]);
    expect(ids(g.revoked)).toEqual(["revoked-new", "revoked-old"]);
    expect(g.active.length + g.expired.length + g.revoked.length).toBe(input.length);
  });

  it("flags a token that expires in exactly 7 days, and not one a moment later", () => {
    expect(EXPIRING_SOON_DAYS).toBe(7);
    const g = groupTokens(
      [tok("just-over", { expiresAt: at(7 * DAY + 1) }), tok("exactly-7", { expiresAt: at(7 * DAY) })],
      NOW
    );
    expect(activeIds(g)).toEqual(["exactly-7", "just-over"]);
    expect(g.active.map((e) => e.expiringSoon)).toEqual([true, false]);
    expect(g.expiringSoon).toBe(1);
  });

  it("never puts a revoked token in Active, even one that has not reached its expiry", () => {
    const g = groupTokens(
      [
        tok("revoked-soon", { revokedAt: at(-DAY), expiresAt: at(2 * DAY) }),
        tok("revoked-later", { revokedAt: at(-DAY), expiresAt: at(200 * DAY) }),
        tok("revoked-expired", { revokedAt: at(-40 * DAY), expiresAt: at(-10 * DAY) }),
      ],
      NOW
    );
    expect(g.active).toEqual([]);
    expect(g.expiringSoon).toBe(0);
    expect(g.expired).toEqual([]);
    expect(ids(g.revoked)).toEqual(["revoked-soon", "revoked-later", "revoked-expired"]);
  });

  it("treats a token that expires right now as expired", () => {
    const g = groupTokens([tok("now", { expiresAt: at(0) })], NOW);
    expect(g.active).toEqual([]);
    expect(ids(g.expired)).toEqual(["now"]);
  });
});

describe("isExpiringSoon", () => {
  it("is true only for active tokens within 7 days", () => {
    expect(isExpiringSoon(tok("a", { expiresAt: at(DAY) }), NOW)).toBe(true);
    expect(isExpiringSoon(tok("b", { expiresAt: at(8 * DAY) }), NOW)).toBe(false);
    expect(isExpiringSoon(tok("c", { expiresAt: at(-DAY) }), NOW)).toBe(false);
    expect(isExpiringSoon(tok("d", { revokedAt: at(-DAY), expiresAt: at(DAY) }), NOW)).toBe(false);
  });
});

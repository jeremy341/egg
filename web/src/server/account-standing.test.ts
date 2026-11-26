import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { upsertUser } from "@/server/auth/session";
import {
  accountExemptRequest,
  accountStanding,
  assertAccountCanWrite,
  GRACE_PERIOD_MS,
  graceEndFor,
} from "@/server/account-standing";

const DAY = 24 * 60 * 60 * 1000;
const SUSPENDED_AT = new Date("2026-11-01T12:00:00.000Z");
const GRACE_ENDS = new Date(SUSPENDED_AT.getTime() + 15 * DAY);
const suspended = { status: "suspended" as const, suspendedAt: SUSPENDED_AT, graceEndsAt: GRACE_ENDS };

describe("accountStanding (pure)", () => {
  it("uses a 15-day grace period from the moment of the ban", () => {
    expect(GRACE_PERIOD_MS).toBe(15 * DAY);
    expect(graceEndFor(SUSPENDED_AT)).toEqual(GRACE_ENDS);
  });

  it("keeps an active account active at any time", () => {
    const active = { status: "active" as const, suspendedAt: null, graceEndsAt: null };
    expect(accountStanding(active, new Date(0))).toEqual({ state: "active" });
    expect(accountStanding(active, GRACE_ENDS)).toEqual({ state: "active" });
  });

  it("is in grace at the start of the ban, showing the end date", () => {
    expect(accountStanding(suspended, SUSPENDED_AT)).toEqual({ state: "grace", graceEndsAt: GRACE_ENDS });
  });

  it("is still in grace one millisecond before the 15 days end", () => {
    const before = new Date(GRACE_ENDS.getTime() - 1);
    expect(accountStanding(suspended, before)).toEqual({ state: "grace", graceEndsAt: GRACE_ENDS });
  });

  it("is blocked exactly at the end of the 15 days", () => {
    expect(accountStanding(suspended, GRACE_ENDS)).toEqual({ state: "blocked", graceEndsAt: GRACE_ENDS });
  });

  it("is blocked one millisecond after the 15 days", () => {
    const after = new Date(GRACE_ENDS.getTime() + 1);
    expect(accountStanding(suspended, after)).toEqual({ state: "blocked", graceEndsAt: GRACE_ENDS });
  });

  it("fails closed: a suspended account with no recorded end is blocked", () => {
    const broken = { status: "suspended" as const, suspendedAt: SUSPENDED_AT, graceEndsAt: null };
    expect(accountStanding(broken, SUSPENDED_AT).state).toBe("blocked");
  });
});

describe("accountExemptRequest", () => {
  it("lets every read through", () => {
    expect(accountExemptRequest("/api/projects", "GET")).toBe(true);
    expect(accountExemptRequest("/api/v1/projects", "HEAD")).toBe(true);
  });

  it("refuses the account's own writes", () => {
    expect(accountExemptRequest("/api/projects", "POST")).toBe(false);
    expect(accountExemptRequest("/api/projects/p1", "PATCH")).toBe(false);
    expect(accountExemptRequest("/api/account/cleanup", "POST")).toBe(false);
  });

  it("leaves the anonymous report POST to its route, which checks a session only when there is a cookie", () => {
    expect(accountExemptRequest("/api/security-reports", "POST")).toBe(true);
  });

  it("keeps sign-out, stop and recovery actions open", () => {
    expect(accountExemptRequest("/api/auth/logout", "POST")).toBe(true);
    expect(accountExemptRequest("/api/deployments/d1/cancel", "POST")).toBe(true);
    expect(accountExemptRequest("/api/v1/deployments/d1/cancel", "POST")).toBe(true);
    expect(accountExemptRequest("/api/cleanup/c1", "DELETE")).toBe(true);
    expect(accountExemptRequest("/api/tokens/t1", "DELETE")).toBe(true);
    expect(accountExemptRequest("/api/account/sessions/s1", "DELETE")).toBe(true);
  });
});

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let active: string;
let graced: string;
let blocked: string;
beforeAll(async () => {
  ctx = await useFreshDb();
  active = (await upsertUser({ id: "standing-active", name: "Active", email: null, slackId: null })).id;
  graced = (await upsertUser({ id: "standing-graced", name: "Graced", email: null, slackId: null })).id;
  blocked = (await upsertUser({ id: "standing-blocked", name: "Blocked", email: null, slackId: null })).id;
  await ctx.db.update(schema.users).set({ status: "suspended", suspendedAt: SUSPENDED_AT, graceEndsAt: GRACE_ENDS }).where(eq(schema.users.id, graced));
  await ctx.db.update(schema.users).set({ status: "suspended", suspendedAt: SUSPENDED_AT, graceEndsAt: GRACE_ENDS }).where(eq(schema.users.id, blocked));
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("assertAccountCanWrite (database)", () => {
  it("new accounts default to active, so the migration does not change existing behaviour", async () => {
    const row = await ctx.db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, active)).get();
    expect(row?.status).toBe("active");
    await expect(assertAccountCanWrite(active)).resolves.toBeUndefined();
  });

  it("lets a graced account write before the end of its grace", async () => {
    await expect(assertAccountCanWrite(graced, { now: new Date(GRACE_ENDS.getTime() - 1) })).resolves.toBeUndefined();
  });

  it("refuses a blocked account with 403 and a clear message, at and after the end", async () => {
    await expect(assertAccountCanWrite(blocked, { now: GRACE_ENDS })).rejects.toMatchObject({
      status: 403,
      code: "account_suspended",
    });
    await expect(assertAccountCanWrite(blocked, { now: new Date("2026-11-20T00:00:00.000Z") })).rejects.toThrow(
      /grace period ended on 2026-11-16/,
    );
  });
});

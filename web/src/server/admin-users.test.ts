import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { upsertUser } from "@/server/auth/session";
import { getCurrentUser } from "@/server/auth/current";
import { GRACE_PERIOD_MS } from "@/server/account-standing";
import {
  banUser,
  liftBan,
  listUsersForAdmin,
  setAdministrator,
  userDetailForAdmin,
} from "@/server/admin-users";
import { isInstanceAdmin } from "@/server/admin-identity";
import { adminOverview } from "@/server/admin";
import { GET as listRoute } from "@/app/api/admin/users/route";
import { POST as banRoute } from "@/app/api/admin/users/[id]/ban/route";

vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let root: string; // the configured instance administrator
let admin: string; // a granted administrator
let person: string; // an ordinary account
let other: string; // another ordinary account, searched by name

const BAN_REASON = "Repeated abuse reports against shared hosting";

beforeAll(async () => {
  ctx = await useFreshDb();
  root = (await upsertUser({ id: "au-root", name: "Root Admin", email: null, slackId: null })).id;
  admin = (await upsertUser({ id: "au-admin", name: "Granted Admin", email: null, slackId: null })).id;
  person = (await upsertUser({ id: "au-person", name: "Quinn Rivera", email: "quinn@example.com", slackId: null, emailVerified: true })).id;
  other = (await upsertUser({ id: "au-other", name: "Other Person", email: null, slackId: null })).id;
  process.env.SECURITY_REPORT_ADMIN_ID = root;
  await ctx.db.insert(schema.instanceAdmins).values({ userId: admin, grantedBy: root, grantedAt: new Date() });
});
afterAll(async () => {
  delete process.env.SECURITY_REPORT_ADMIN_ID;
  await ctx.cleanup();
});
beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset();
});

async function userRow(id: string) {
  return ctx.db.select().from(schema.users).where(eq(schema.users.id, id)).get();
}

async function auditFor(target: string, action: string) {
  return ctx.db
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.target, target), eq(schema.auditLog.action, action)))
    .orderBy(desc(schema.auditLog.id));
}

describe("administration is checked on the server", () => {
  it("refuses every account-admin read and change to an ordinary account", async () => {
    await expect(listUsersForAdmin(person, "Quinn")).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(userDetailForAdmin(person, other)).rejects.toMatchObject({ status: 403 });
    await expect(banUser(person, other, { reason: BAN_REASON }, true)).rejects.toMatchObject({ status: 403 });
    await expect(liftBan(person, other, { reason: BAN_REASON }, true)).rejects.toMatchObject({ status: 403 });
    await expect(setAdministrator(person, other, { administrator: true }, true)).rejects.toMatchObject({ status: 403 });
    expect((await userRow(other))?.status).toBe("active");
    expect(await isInstanceAdmin(other)).toBe(false);
  });

  it("the HTTP route refuses an ordinary signed-in account before doing anything", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: person, name: "Quinn", email: null, hackClubId: "au-person" });
    const res = await listRoute(new NextRequest("http://localhost:3000/api/admin/users?q=Other"), undefined as never);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");

    const ban = await banRoute(
      new NextRequest(`http://localhost:3000/api/admin/users/${other}/ban`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: BAN_REASON }),
      }),
      { params: Promise.resolve({ id: other }) },
    );
    expect(ban.status).toBe(403);
    expect((await userRow(other))?.status).toBe("active");
  });

  it("needs a fresh Hack Club sign-in for a ban or an administrator change", async () => {
    await expect(banUser(admin, other, { reason: BAN_REASON }, false)).rejects.toMatchObject({ status: 403, code: "reauth_required" });
    await expect(setAdministrator(admin, other, { administrator: true }, false)).rejects.toMatchObject({ code: "reauth_required" });
    expect((await userRow(other))?.status).toBe("active");
  });
});

describe("finding accounts", () => {
  it("searches by name fragment and by exact Hack Club id", async () => {
    const byName = await listUsersForAdmin(admin, "quinn");
    expect(byName.users.map((u) => u.id)).toEqual([person]);
    expect(byName.users[0]).toMatchObject({ standing: "active", administrator: false });

    const byId = await listUsersForAdmin(admin, "au-other");
    expect(byId.users.map((u) => u.id)).toEqual([other]);
  });

  it("treats LIKE wildcards as plain text", async () => {
    const wild = await listUsersForAdmin(admin, "%");
    expect(wild.users.length).toBeGreaterThan(0);
    const literal = await listUsersForAdmin(admin, "Quinn%Rivera");
    expect(literal.users).toEqual([]);
  });
});

describe("bans", () => {
  it("refuses a ban without a real reason, and changes nothing", async () => {
    await expect(banUser(admin, other, { reason: "no" }, true)).rejects.toThrow();
    expect((await userRow(other))?.status).toBe("active");
  });

  it("will not ban yourself or an administrator", async () => {
    await expect(banUser(admin, admin, { reason: BAN_REASON }, true)).rejects.toMatchObject({ status: 400 });
    await expect(banUser(admin, root, { reason: BAN_REASON }, true)).rejects.toMatchObject({ status: 400 });
    expect((await userRow(root))?.status).toBe("active");
  });

  it("suspends with a 15-day grace period, and records the reason in the audit log", async () => {
    const before = Date.now();
    const res = await banUser(admin, other, { reason: BAN_REASON }, true);
    expect(res.changed).toBe(true);
    const row = await userRow(other);
    expect(row?.status).toBe("suspended");
    expect(row?.suspensionReason).toBe(BAN_REASON);
    const ends = row!.graceEndsAt!.getTime();
    expect(ends - row!.suspendedAt!.getTime()).toBe(GRACE_PERIOD_MS);
    expect(ends).toBeGreaterThanOrEqual(before + GRACE_PERIOD_MS);

    const [entry] = await auditFor(other, "admin.ban");
    expect(entry?.userId).toBe(admin);
    expect(JSON.parse(entry!.meta!)).toMatchObject({ reason: BAN_REASON });
  });

  it("does not write a second entry when the account is already banned", async () => {
    expect(await banUser(admin, other, { reason: BAN_REASON }, true)).toMatchObject({ changed: false });
    expect(await auditFor(other, "admin.ban")).toHaveLength(1);
  });
});

describe("lifting a ban", () => {
  it("restores the account at once and records the lift with the original ban reason", async () => {
    const res = await liftBan(admin, other, { reason: "Appeal accepted after review" }, true);
    expect(res.changed).toBe(true);
    const row = await userRow(other);
    expect(row).toMatchObject({ status: "active", suspendedAt: null, graceEndsAt: null, suspensionReason: null });

    const [entry] = await auditFor(other, "admin.unban");
    expect(JSON.parse(entry!.meta!)).toEqual({ reason: "Appeal accepted after review", banReason: BAN_REASON });
  });

  it("does nothing for an account that is not banned", async () => {
    expect(await liftBan(admin, other, { reason: "Nothing to lift here" }, true)).toMatchObject({ changed: false });
    expect(await auditFor(other, "admin.unban")).toHaveLength(1);
  });
});

describe("administrators from the users page", () => {
  it("grants and removes administration, and keeps the configured account", async () => {
    expect(await setAdministrator(admin, other, { administrator: true }, true)).toMatchObject({ changed: true });
    expect(await isInstanceAdmin(other)).toBe(true);

    expect(await setAdministrator(admin, other, { administrator: false }, true)).toMatchObject({ changed: true });
    expect(await isInstanceAdmin(other)).toBe(false);

    await expect(setAdministrator(admin, root, { administrator: false }, true)).rejects.toMatchObject({ status: 400 });
    expect(await isInstanceAdmin(root)).toBe(true);
  });

  it("will not make a banned account an administrator", async () => {
    await banUser(admin, person, { reason: BAN_REASON }, true);
    await expect(setAdministrator(admin, person, { administrator: true }, true)).rejects.toMatchObject({ status: 400 });
    expect(await isInstanceAdmin(person)).toBe(false);
    await liftBan(admin, person, { reason: "Ban was a mistake" }, true);
  });

  it("writes an audit entry for each grant and removal", async () => {
    expect((await auditFor(other, "admin.grant")).length).toBeGreaterThanOrEqual(1);
    expect((await auditFor(other, "admin.revoke")).length).toBeGreaterThanOrEqual(1);
  });
});

describe("the account detail page data", () => {
  it("shows standing and history with reasons, newest first", async () => {
    await banUser(admin, person, { reason: BAN_REASON }, true);
    const detail = await userDetailForAdmin(admin, person);
    expect(detail.standing.state).toBe("grace");
    expect(detail.standing.graceEndsAt).not.toBeNull();
    expect(detail.history[0]).toMatchObject({ action: "admin.ban", reason: BAN_REASON, actor: "Granted Admin" });
    await liftBan(admin, person, { reason: "Ban was a mistake" }, true);
    const after = await userDetailForAdmin(admin, person);
    expect(after.standing.state).toBe("active");
    expect(after.history[0]).toMatchObject({ action: "admin.unban", reason: "Ban was a mistake" });
  });
});

describe("the administration log", () => {
  it("lists each ban, unban and administrator change with a readable label", async () => {
    const overview = await adminOverview(admin);
    const byAction = (action: string) => overview.events.filter((e) => e.action === action);
    expect(byAction("admin.ban")[0]).toMatchObject({ label: "Banned an account" });
    expect(byAction("admin.unban")[0]).toMatchObject({ label: "Lifted a ban on an account" });
    expect(byAction("admin.grant")[0]).toMatchObject({ label: "Made someone an administrator" });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal, Scope } from "@/server/api-tokens";
import { makeCursor } from "@/server/activity";
import { callEndpoint } from "@/server/api-v1";
import { AUDIT_ENDPOINTS } from "@/server/api-v1-audit";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";

/**
 * The route that serves this endpoint is wired up by the integration layer;
 * here the endpoint itself is driven through the same `callEndpoint` used by
 * the HTTP and MCP transports, with a fresh database for the file.
 */
let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let me: { id: string };
let other: { id: string };

const ep = AUDIT_ENDPOINTS.find((e) => e.id === "get_audit_log")!;
const principal = (userId: string, scopes: Scope[] = ["activity:read"]): Principal => ({
  userId,
  tokenId: "token-test-1",
  scopes,
});

type Entry = {
  id: number;
  action: string;
  kind: string;
  at: string;
  label: string;
  target: { name: string; gone: boolean } | null;
  targetId: string | null;
  suffix: string | null;
  fields: { label: string; value: string }[];
  meta: Record<string, string | number | boolean>;
  viaToken: { name: string | null } | null;
  tokenId: string | null;
  tone: string;
};
type Page = {
  entries: Entry[];
  items: Entry[];
  nextCursor: string | null;
  total: number | null;
};

const run = async (input: Record<string, unknown> = {}, userId = me.id, scopes: Scope[] = ["activity:read"]) =>
  (await callEndpoint(principal(userId, scopes), ep, input)) as Page;

const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000);

async function row(
  userId: string,
  action: string,
  at: Date,
  target: string | null = null,
  meta: Record<string, unknown> | null = null
) {
  await ctx.db.insert(schema.auditLog).values({
    userId,
    action,
    target,
    meta: meta ? JSON.stringify(meta) : null,
    at,
  });
}

beforeAll(async () => {
  ctx = await useFreshDb();
  me = await upsertUser({ id: "audit-1", name: "Sam", email: null, slackId: null });
  other = await upsertUser({ id: "audit-2", name: "Kim", email: null, slackId: null });
  await ctx.db.delete(schema.auditLog);
  await row(me.id, "project.create", hoursAgo(1), "p1", { name: "App" });
  // A secret-looking key and value planted in meta must not reach the response.
  await row(me.id, "domain.add", hoursAgo(2), "p1", {
    domain: "app.example.com",
    apiKey: "should-not-leak",
    note: "https://hooks.slack.com/services/PLANTEDSECRET",
  });
  await row(me.id, "token.create", hoursAgo(3), "t1", { name: "agent", token: "token-test-1", via: "api" });
  await row(me.id, "monitor.down", hoursAgo(49), "p1", { detail: "HTTP 502" });
  await row(other.id, "project.create", hoursAgo(1), "p2", { name: "Their", secret: "their-secret" });
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("the audit log endpoint", () => {
  it("is a read tagged Activity, needing activity:read, with the same filters as the activity page", () => {
    expect(ep).toMatchObject({
      method: "GET",
      path: "/audit-log",
      scope: "activity:read",
      bucket: "read",
      tag: "Activity",
      readOnly: true,
      destructive: false,
    });
    expect(Object.keys(ep.query)).toEqual(["kind", "range", "limit", "cursor"]);
  });

  it("returns only the caller's entries, newest first, with readable and cleaned details", async () => {
    const page = await run();
    expect(page.total).toBe(4);
    expect(page.entries.map((e) => e.action)).toEqual([
      "project.create",
      "domain.add",
      "token.create",
      "monitor.down",
    ]);
    expect(page.items).toEqual(page.entries);

    const domain = page.entries[1];
    expect(domain).toMatchObject({
      kind: "domains",
      targetId: "p1",
      meta: { domain: "app.example.com" },
    });
    expect(domain.target).toMatchObject({ name: "app.example.com", gone: false });
    expect(domain.meta).not.toHaveProperty("apiKey");
    expect(domain.meta).not.toHaveProperty("note");

    const madeByToken = page.entries[2];
    expect(madeByToken).toMatchObject({ tokenId: "token-test-1", viaToken: { name: null } });

    const text = JSON.stringify(page);
    expect(text).not.toContain("should-not-leak");
    expect(text).not.toContain("PLANTEDSECRET");
    expect(text).not.toContain("their-secret");
    expect(page.entries.some((e) => e.targetId === "p2")).toBe(false);
  });

  it("pages with limit and cursor, without repeating or skipping an entry", async () => {
    const first = await run({ limit: 2 });
    expect(first.entries.map((e) => e.action)).toEqual(["project.create", "domain.add"]);
    expect(first.nextCursor).toMatch(/^\d{1,15}\.\d{1,12}$/);
    expect(first.total).toBe(4);

    const second = await run({ limit: 2, cursor: first.nextCursor! });
    expect(second.entries.map((e) => e.action)).toEqual(["token.create", "monitor.down"]);
    expect(second.nextCursor).toBeNull();
    expect(second.total).toBe(4);

    // An older cursor from the last page keeps returning an empty tail.
    const tail = second.entries.at(-1)!;
    const done = await run({ limit: 2, cursor: makeCursor(tail.at, tail.id) });
    expect(done.entries).toHaveLength(0);
  });

  it("filters by kind and by how far back, using the activity service's rules", async () => {
    const domains = await run({ kind: "domains" });
    expect(domains.entries.map((e) => e.action)).toEqual(["domain.add"]);
    expect(domains.total).toBe(1);

    const recent = await run({ range: "24h" });
    expect(recent.total).toBe(3);
    expect(recent.entries.map((e) => e.action)).not.toContain("monitor.down");

    const everything = await run({ kind: "all", range: "all", limit: 1 });
    expect(everything.total).toBe(4);
    expect(everything.entries).toHaveLength(1);
    expect(everything.nextCursor).not.toBeNull();
  });

  it("needs the activity:read scope before reading anything, and validates its query", async () => {
    await expect(run({}, me.id, ["projects:read"])).rejects.toMatchObject({ status: 403 });
    for (const input of [
      { kind: "not-a-kind" },
      { range: "not-a-range" },
      { limit: 0 },
      { limit: 101 },
      { cursor: "abc" },
    ]) {
      await expect(run(input), JSON.stringify(input)).rejects.toMatchObject({ status: 400 });
    }
  });
});

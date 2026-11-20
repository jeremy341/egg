import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { startMockSsh, type MockSsh } from "@/server/test/mock-ssh";
import { useFreshDb } from "@/server/test/db";

vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));

import { getCurrentUser } from "@/server/auth/current";
import { createServer, getServerForUser } from "@/server/servers";
import { POST } from "@/app/api/servers/[id]/test/route";

const ORIGIN = "http://localhost:3000";
const post = (id: string, body?: unknown) =>
  POST(
    new NextRequest(`${ORIGIN}/x`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let mock: MockSsh;
let serverId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "hk1", name: "Sam", email: null, slackId: null })).id;
  const row = await createServer(userId, "sam-hk", { host: "127.0.0.1", port: 1 });
  serverId = row.id;
  mock = await startMockSsh({ authorizedKeys: [row.publicKey] });
  await ctx.db.update(schema.servers).set({ port: mock.port }).where(eq(schema.servers.id, serverId));
});
afterAll(async () => {
  await mock?.stop();
  await ctx.cleanup();
});
beforeEach(() => {
  rateLimiter().clear();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: userId } as never);
});

describe("POST /api/servers/:id/test host key confirmation", () => {
  it("shows the fingerprint on the first call and pins nothing", async () => {
    const res = await post(serverId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { ok: boolean; kind: string; hostKey: string; error: string } };
    expect(body.result).toMatchObject({ ok: false, kind: "host-key-unconfirmed", error: "Confirm host key", hostKey: mock.hostKeyFingerprint });
    expect((await getServerForUser(userId, serverId)).hostKeyFingerprint).toBeNull();
  });

  it("rejects a malformed fingerprint with 400", async () => {
    expect((await post(serverId, { confirmHostKey: "not-a-fingerprint" })).status).toBe(400);
    expect((await getServerForUser(userId, serverId)).hostKeyFingerprint).toBeNull();
  });

  it("does not pin a fingerprint the host does not present", async () => {
    const res = await post(serverId, { confirmHostKey: "SHA256:" + "D".repeat(43) });
    const body = (await res.json()) as { result: { ok: boolean; kind: string } };
    expect(body.result).toMatchObject({ ok: false, kind: "host-key" });
    expect((await getServerForUser(userId, serverId)).hostKeyFingerprint).toBeNull();
  });

  it("pins and probes once the shown fingerprint is sent back", async () => {
    const res = await post(serverId, { confirmHostKey: mock.hostKeyFingerprint });
    const body = (await res.json()) as { result: { ok: boolean } };
    expect(body.result.ok).toBe(true);
    expect((await getServerForUser(userId, serverId)).hostKeyFingerprint).toBe(mock.hostKeyFingerprint);
  });

  it("caps host-key test connections per user before any SSH work, with Retry-After", async () => {
    for (let i = 0; i < RATE_LIMITS.sshCall.limit; i++) expect((await post(serverId)).status).toBe(200);
    const res = await post(serverId);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await res.json()).error?.code).toBe("rate_limited");
  });
});

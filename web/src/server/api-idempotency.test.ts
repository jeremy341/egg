import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { createApiToken } from "@/server/api-tokens";
import {
  clearIdempotencyKeys,
  fingerprintOf,
  IDEMPOTENCY_TTL_MS,
  idempotencyKeyFrom,
  withIdempotency,
} from "@/server/api-idempotency";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { createServer } from "@/server/servers";
import { rateLimiter } from "@/server/rate-limit";
import { useFreshDb } from "@/server/test/db";
import { POST as createProjectRoute } from "@/app/api/v1/projects/route";

vi.mock("@/server/auth/current", () => ({
  getCurrentUser: vi.fn(),
  requireUser: vi.fn(),
}));

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let serverId: string;
let secret: string;
let tokenId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  const me = await upsertUser({ id: "idem-1", name: "Sam", email: null, slackId: null });
  userId = me.id;
  serverId = (await createServer(me.id, "idem-server")).id;
  const minted = await createApiToken(me.id, { name: "idem", scopes: ["projects:write", "projects:read"] });
  secret = minted.secret;
  tokenId = minted.token.id;
});
afterAll(async () => ctx.cleanup());
beforeEach(() => {
  clearIdempotencyKeys();
  rateLimiter().clear();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("withIdempotency: the three cases", () => {
  it("runs the write once and replays the first answer for the same key and request", async () => {
    let runs = 0;
    const run = async () => {
      runs++;
      return json(201, { id: `made-${runs}` });
    };
    const first = await withIdempotency({ scope: "tok", key: "k1", fingerprint: "fp", run });
    const second = await withIdempotency({ scope: "tok", key: "k1", fingerprint: "fp", run });
    expect(runs).toBe(1);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual({ id: "made-1" });
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
    expect(first.headers.get("Idempotent-Replayed")).toBeNull();
  });

  it("answers 422 when the same key comes with a different request, and never runs it", async () => {
    let runs = 0;
    const run = async () => {
      runs++;
      return json(201, { ok: true });
    };
    await withIdempotency({ scope: "tok", key: "k2", fingerprint: fingerprintOf("POST", "/x", '{"a":1}'), run });
    const err = await withIdempotency({
      scope: "tok",
      key: "k2",
      fingerprint: fingerprintOf("POST", "/x", '{"a":2}'),
      run,
    }).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(422);
    expect(runs).toBe(1);
  });

  it("answers 409 while a request with the same key is still in progress", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = withIdempotency({
      scope: "tok",
      key: "k3",
      fingerprint: "fp",
      run: async () => {
        await gate;
        return json(202, { queued: true });
      },
    });
    const busy = await withIdempotency({ scope: "tok", key: "k3", fingerprint: "fp", run: async () => json(202, {}) }).then(
      () => null,
      (e: unknown) => e
    );
    expect(busy).toBeInstanceOf(HttpError);
    expect((busy as HttpError).status).toBe(409);
    expect((busy as HttpError).headers?.["Retry-After"]).toBe("1");

    release();
    expect((await slow).status).toBe(202);
    // Once it finished, the same key replays it.
    expect((await withIdempotency({ scope: "tok", key: "k3", fingerprint: "fp", run: async () => json(500, {}) })).status).toBe(202);
  });

  it("keeps keys apart per token, so one token cannot replay another's answer", async () => {
    await withIdempotency({ scope: "tokA", key: "shared", fingerprint: "fp", run: async () => json(201, { who: "A" }) });
    const b = await withIdempotency({ scope: "tokB", key: "shared", fingerprint: "fp", run: async () => json(201, { who: "B" }) });
    expect(await b.json()).toEqual({ who: "B" });
  });

  it("forgets a key after 24 hours", async () => {
    const t0 = 1_000_000;
    await withIdempotency({ scope: "tok", key: "old", fingerprint: "fp", now: t0, run: async () => json(201, { n: 1 }) });
    const later = await withIdempotency({
      scope: "tok",
      key: "old",
      fingerprint: "other",
      now: t0 + IDEMPOTENCY_TTL_MS - 1,
      run: async () => json(201, { n: 2 }),
    }).then(
      (r) => r,
      (e: unknown) => e
    );
    expect(later).toBeInstanceOf(HttpError); // still inside the window: different request is 422
    const expired = await withIdempotency({
      scope: "tok",
      key: "old",
      fingerprint: "other",
      now: t0 + IDEMPOTENCY_TTL_MS,
      run: async () => json(201, { n: 3 }),
    });
    expect(await expired.json()).toEqual({ n: 3 });
  });

  it("keeps no answer for a server error, so a retry runs the write again", async () => {
    let runs = 0;
    const flaky = await withIdempotency({
      scope: "tok",
      key: "boom",
      fingerprint: "fp",
      run: async () => {
        runs++;
        return json(500, { error: { code: "internal" } });
      },
    });
    expect(flaky.status).toBe(500);
    const retry = await withIdempotency({ scope: "tok", key: "boom", fingerprint: "fp", run: async () => (runs++, json(201, {})) });
    expect(retry.status).toBe(201);
    expect(runs).toBe(2);
  });

  it("rejects a malformed key with 400 and accepts a normal one", () => {
    expect(idempotencyKeyFrom(new Request("http://x", { method: "POST" }))).toBeNull();
    expect(idempotencyKeyFrom(new Request("http://x", { headers: { "Idempotency-Key": "abc-123" } }))).toBe("abc-123");
    for (const bad of ["x".repeat(256), "has space", "tab\tkey"]) {
      expect(() => idempotencyKeyFrom(new Request("http://x", { headers: { "Idempotency-Key": bad } }))).toThrow(HttpError);
    }
  });
});

describe("the write routes under /api/v1", () => {
  const siteBody = () => ({ serverId, name: "Idem Site", repoUrl: "https://github.com/sam/idem.git", runtime: "static", port: 3910, outputDir: "dist" });
  const post = (payload: unknown, key?: string) =>
    createProjectRoute(
      new NextRequest("http://localhost:3000/api/v1/projects", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: typeof payload === "string" ? payload : JSON.stringify(payload),
      }),
      { params: Promise.resolve({}) }
    );

  it("creates the project once for a repeated key, and returns the same answer", async () => {
    const first = await post(siteBody(), "create-once-1");
    expect(first.status).toBe(201);
    const firstBody = await first.text();
    const second = await post(siteBody(), "create-once-1");
    expect(second.status).toBe(201);
    expect(await second.text()).toBe(firstBody);
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");

    const rows = await ctx.db.select().from(schema.projects).where(eq(schema.projects.userId, userId));
    expect(rows.filter((r) => r.name === "Idem Site")).toHaveLength(1);
  });

  it("refuses a repeated key with a different body with 422, and creates nothing", async () => {
    expect((await post({ ...siteBody(), name: "Mismatch Site", port: 3913 }, "create-mismatch-1")).status).toBe(201);
    const res = await post({ ...siteBody(), name: "Other Name", port: 3913 }, "create-mismatch-1");
    expect(res.status).toBe(422);
    const rows = await ctx.db.select().from(schema.projects).where(eq(schema.projects.userId, userId));
    expect(rows.some((r) => r.name === "Other Name")).toBe(false);
  });

  it("stores a validation failure as the first answer and replays it", async () => {
    const bad = { ...siteBody(), name: "" };
    const first = await post(bad, "create-invalid-1");
    expect(first.status).toBe(400);
    const again = await post(bad, "create-invalid-1");
    expect(again.status).toBe(400);
    expect(again.headers.get("Idempotent-Replayed")).toBe("true");
  });

  it("still works without a key, and rejects a bad key before running anything", async () => {
    const plain = await post({ ...siteBody(), name: "No Key Site", port: 3911 });
    expect(plain.status).toBe(201);
    const bad = await post({ ...siteBody(), name: "Bad Key Site", port: 3912 }, "has space");
    expect(bad.status).toBe(400);
    const rows = await ctx.db.select().from(schema.projects).where(eq(schema.projects.userId, userId));
    expect(rows.some((r) => r.name === "Bad Key Site")).toBe(false);
  });
});

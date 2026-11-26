import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { schema } from "@/server/db";
import { buildNestStatus } from "@/server/nest-status";
import { useFreshDb } from "@/server/test/db";
import { GET } from "@/app/api/status/nest/route";

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => undefined,
}));

// The real cache needs the Next.js runtime. The route's job is what it does with the data.
vi.mock("@/server/nest-status-cache", () => ({
  getCachedNestStatus: () =>
    buildNestStatus(new Date("2026-11-09T12:00:00Z"), {
      official: async () => ({ available: true, summary: "Partial System Outage", statusClass: "bg-down", readAt: "2026-11-09T11:59:30.000Z" }),
    }),
}));

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
beforeAll(async () => {
  ctx = await useFreshDb();
  const at = new Date("2026-11-09T11:59:00Z");
  await ctx.db.insert(schema.statusProbes).values([
    { target: "nest-site", checkedAt: at, ok: true, httpStatus: 200, latencyMs: 310 },
    { target: "nest-app", checkedAt: at, ok: true, httpStatus: 200, latencyMs: 280 },
    { target: "egg", checkedAt: at, ok: true, httpStatus: null, latencyMs: 2 },
  ]);
});
afterAll(async () => {
  await ctx.cleanup();
});

const request = (headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/status/nest", { headers });

describe("GET /api/status/nest", () => {
  it("returns the overall line, the three targets with their strips, and the official summary apart", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(res.headers.get("set-cookie")).toBeNull();

    const body = await res.json();
    expect(body.overall).toEqual({ state: "ok", text: "Nest and Egg are working" });
    expect(body.targets.map((t: { id: string }) => t.id)).toEqual(["nest-site", "nest-app", "egg"]);
    for (const t of body.targets) {
      expect(Object.keys(t).sort()).toEqual([
        "checkedAt", "days", "httpStatus", "id", "label", "latencyMs", "median24hMs", "median30dMs", "state", "url",
      ]);
      expect(t.days).toHaveLength(30);
      expect(t.state).toBe("up");
    }
    expect(body.targets[0]).toMatchObject({ label: "Nest website", url: "https://nest.hackclub.com", httpStatus: 200, latencyMs: 310 });
    expect(body.targets[1]).toMatchObject({ label: "Nest sign-in and app host", url: "https://hackclub.app" });
    expect(body.targets[2]).toMatchObject({ label: "Egg", url: null });
    expect(body.official).toEqual({
      available: true,
      summary: "Partial System Outage",
      statusClass: "bg-down",
      readAt: "2026-11-09T11:59:30.000Z",
      url: "https://status.hackclub.app",
    });
    expect(body.lastCheckAt).toBe("2026-11-09T11:59:00.000Z");
  });

  it("answers 304 with no body when If-None-Match names the current ETag", async () => {
    const first = await GET(request());
    const etag = first.headers.get("etag")!;
    const again = await GET(request({ "if-none-match": etag }));
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("etag")).toBe(etag);
    expect(again.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("sends the body again when the ETag does not match", async () => {
    const res = await GET(request({ "if-none-match": '"something-else"' }));
    expect(res.status).toBe(200);
  });
});

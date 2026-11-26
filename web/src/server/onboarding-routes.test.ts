import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { upsertUser } from "@/server/auth/session";
import { getMarks } from "@/server/onboarding";
import { useFreshDb } from "@/server/test/db";

// The route layer and the database are real. Only sign-in is replaced.
vi.mock("@/server/auth/current", () => ({
  getCurrentUser: vi.fn(),
  requireUser: vi.fn(),
}));

import { getCurrentUser } from "@/server/auth/current";
import { DELETE, GET, PUT } from "@/app/api/onboarding/route";

let cleanup: () => Promise<void>;
let user: Awaited<ReturnType<typeof upsertUser>>;

const URL_BASE = "http://localhost:3000/api/onboarding";

function put(body: unknown, headers: Record<string, string> = {}) {
  return PUT(
    new NextRequest(URL_BASE, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    undefined
  );
}

function del(query = "", headers: Record<string, string> = {}) {
  return DELETE(new NextRequest(`${URL_BASE}${query}`, { method: "DELETE", headers }), undefined);
}

function get() {
  return GET(new NextRequest(URL_BASE), undefined);
}

beforeAll(async () => {
  const t = await useFreshDb();
  cleanup = t.cleanup;
  user = await upsertUser({ id: "hc-onboarding-route", name: "Route Person", email: null, slackId: null });
});
afterAll(async () => cleanup());
beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue(user);
});

describe("/api/onboarding", () => {
  it("needs a signed-in person for every method", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect((await put({ chapter: "connect", status: "done" })).status).toBe(401);
    expect((await del()).status).toBe(401);
    expect((await del("?chapter=connect")).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    expect(await getMarks(user.id)).toEqual({});
  });

  it("GET answers with the marks, starting from none", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ marks: {} });
  });

  it("PUT stores a mark and answers with all the marks", async () => {
    const res = await put({ chapter: "connect", status: "done" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marks: { connect: "done" } });

    const again = await put({ chapter: "import", status: "skipped" });
    expect(await again.json()).toEqual({ marks: { connect: "done", import: "skipped" } });
    expect(await getMarks(user.id)).toEqual({ connect: "done", import: "skipped" });
  });

  it("PUT accepts each status and overwrites a mark", async () => {
    expect((await put({ chapter: "deploy", status: "paused" })).status).toBe(200);
    expect(await (await put({ chapter: "deploy", status: "done" })).json()).toEqual({
      marks: { connect: "done", import: "skipped", deploy: "done" },
    });
  });

  it("PUT with an unknown chapter or status is a 400 and stores nothing", async () => {
    const before = await getMarks(user.id);
    for (const body of [
      { chapter: "telepathy", status: "done" },
      { chapter: "Connect", status: "done" },
      { chapter: "address", status: "started" },
      { chapter: "address" },
      { status: "done" },
      { chapter: 1, status: "done" },
      { chapter: "address", status: ["done"] },
    ]) {
      const res = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error.code).toBe("validation");
    }
    expect(await getMarks(user.id)).toEqual(before);
  });

  it("PUT refuses fields it does not know, and a body that is not JSON", async () => {
    const before = await getMarks(user.id);
    expect((await put({ chapter: "address", status: "done", userId: "someone-else" })).status).toBe(400);
    expect((await put("not json")).status).toBe(400);
    expect(await getMarks(user.id)).toEqual(before);
  });

  it("PUT blocks a write from another site", async () => {
    const before = await getMarks(user.id);
    const res = await put({ chapter: "address", status: "done" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await getMarks(user.id)).toEqual(before);
  });

  it("DELETE with a chapter clears only that mark", async () => {
    const res = await del("?chapter=import");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marks: { connect: "done", deploy: "done" } });
  });

  it("DELETE with an unknown chapter is a 400 and clears nothing", async () => {
    const before = await getMarks(user.id);
    for (const query of ["?chapter=telepathy", "?chapter=", "?chapter=CONNECT"]) {
      const res = await del(query);
      expect(res.status, query).toBe(400);
      expect((await res.json()).error.code).toBe("validation");
    }
    expect(await getMarks(user.id)).toEqual(before);
  });

  it("DELETE blocks a write from another site", async () => {
    const res = await del("?chapter=connect", { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await getMarks(user.id)).toEqual({ connect: "done", deploy: "done" });
  });

  it("DELETE with no chapter clears every mark", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marks: {} });
    expect(await getMarks(user.id)).toEqual({});
  });
});

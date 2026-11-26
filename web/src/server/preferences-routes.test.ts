import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { upsertUser } from "@/server/auth/session";
import { getPreferences } from "@/server/preferences";
import { useFreshDb } from "@/server/test/db";

// The route layer and the database are real. Only sign-in is replaced.
vi.mock("@/server/auth/current", () => ({
  getCurrentUser: vi.fn(),
  requireUser: vi.fn(),
}));

import { getCurrentUser } from "@/server/auth/current";
import { GET, PATCH } from "@/app/api/preferences/route";

let cleanup: () => Promise<void>;
let user: Awaited<ReturnType<typeof upsertUser>>;

function patch(body: unknown, headers: Record<string, string> = {}) {
  return PATCH(
    new NextRequest("http://localhost:3000/api/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    undefined
  );
}

beforeAll(async () => {
  const t = await useFreshDb();
  cleanup = t.cleanup;
  user = await upsertUser({ id: "hc-prefs-route", name: "Route Person", email: null, slackId: null });
});
afterAll(async () => cleanup());
beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue(user);
});

describe("PATCH /api/preferences", () => {
  it("needs a signed-in person", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await patch({ theme: "dark" })).status).toBe(401);
    expect((await GET(new NextRequest("http://localhost:3000/api/preferences"), undefined)).status).toBe(401);
  });

  it("blocks a write from another site", async () => {
    const res = await patch({ theme: "dark" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect((await getPreferences(user.id)).theme).toBe("system");
  });

  it("blocks a browser request marked cross-site that has no Origin", async () => {
    expect((await patch({ theme: "dark" }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  it("rejects values outside the lists with a 400 and a message", async () => {
    const res = await patch({ accent: "pink" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
    expect((await patch({ avatar: "pixel-99" })).status).toBe(400);
    expect((await patch({ displayName: "x".repeat(41) })).status).toBe(400);
    expect((await patch({ defaultBranch: "bad branch" })).status).toBe(400);
  });

  it("rejects a body that is not JSON, and one that is far too large", async () => {
    expect((await patch("not json")).status).toBe(400);
    expect((await patch({ displayName: "x".repeat(10_000) })).status).toBe(413);
  });

  it("saves, answers with the full preferences, and sets the egg_prefs cookie", async () => {
    const res = await patch(
      { theme: "dark", accent: "blue", density: "compact", displayName: " Rae ", avatar: "pixel-03" },
      { origin: "http://localhost:3000" }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.preferences).toMatchObject({
      theme: "dark",
      accent: "blue",
      density: "compact",
      displayName: "Rae",
      avatar: "pixel-03",
    });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("egg_prefs=");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toMatch(/httponly/i);
    // The cookie holds the look, never the name or the branch.
    expect(decodeURIComponent(cookie)).toContain("theme=dark&accent=blue&density=compact&motion=system");
    expect(decodeURIComponent(cookie)).not.toContain("Rae");
    expect((await getPreferences(user.id)).displayName).toBe("Rae");
  });

  it("reads back what was saved, uncached", async () => {
    const res = await GET(new NextRequest("http://localhost:3000/api/preferences"), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).preferences.accent).toBe("blue");
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { upsertUser } from "@/server/auth/session";
import { useFreshDb } from "@/server/test/db";

// Session auth is replaced; the rest of the route (and the real DB) stays intact.
const auth = vi.hoisted(() => ({ user: "" as string }));
vi.mock("@/server/http", async (orig) => ({
  ...(await orig<typeof import("@/server/http")>()),
  authed: async () => ({ id: auth.user }),
}));

import { GET, POST } from "@/app/api/registries/route";
import { PATCH } from "@/app/api/registries/[id]/route";

const PASSWORD = "route-test-password-xyz";
let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "registry-route", name: "Route", email: null, slackId: null })).id;
  auth.user = userId;
});

afterAll(async () => {
  await ctx.cleanup();
});

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost:3000/api/registries", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify(body) }),
    {} as never
  );
}

describe("/api/registries", () => {
  it("creates a login and returns it without the password", async () => {
    const res = await post({ host: "ghcr.io", username: "robot", password: PASSWORD });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(PASSWORD);
    expect(text).toContain("ghcr.io");
  });

  it("lists logins without the password, sealed or plain", async () => {
    const res = await GET(new NextRequest("http://localhost:3000/api/registries"), {} as never);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain("passwordEnc");
    expect(text).toContain("ghcr.io");
  });

  it("does not return the password after an update", async () => {
    const list = (await (await GET(new NextRequest("http://localhost:3000/api/registries"), {} as never)).json()) as { logins: { id: string }[] };
    const id = list.logins[0].id;
    const res = await PATCH(
      new NextRequest(`http://localhost:3000/api/registries/${id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ password: "another-secret-value" }) }),
      { params: Promise.resolve({ id }) } as never
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("another-secret-value");
    expect(text).not.toContain(PASSWORD);
  });
});

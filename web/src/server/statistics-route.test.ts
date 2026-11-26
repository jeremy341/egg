import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { upsertUser } from "@/server/auth/session";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/server/http", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/http")>();
  return {
    ...real,
    authed: async () => ({ id: session.userId }),
  };
});

import { GET, PATCH } from "@/app/api/projects/[id]/statistics/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let projectId: string;
let ownerId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  ownerId = (await upsertUser({ id: "stats-route-owner", name: "Sam", email: null, slackId: null })).id;
  await upsertUser({ id: "stats-route-other", name: "Alex", email: null, slackId: null });
  const serverId = (await createServer(ownerId, "stats-route-owner")).id;
  projectId = (
    await createProject(ownerId, {
      serverId,
      repoUrl: "https://github.com/sam/app.git",
      runtime: "node",
      port: 3000,
      name: "App",
      slug: "app",
    })
  ).id;
  session.userId = ownerId;
});

beforeEach(() => {
  session.userId = ownerId;
});

afterAll(async () => {
  await ctx.cleanup();
});

function patch(body: unknown) {
  return new NextRequest(`http://localhost/api/projects/${projectId}/statistics`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

const ctxFor = (id = projectId) => ({ params: Promise.resolve({ id }) });

describe("statistics API route", () => {
  it("reads all switches off by default", async () => {
    const res = await GET(new NextRequest(`http://localhost/api/projects/${projectId}/statistics`), ctxFor());
    expect(res.status).toBe(200);
    expect((await res.json()).statistics).toEqual({ deployCount: false, deploySuccess: false, buildTime: false, visitors: false });
  });

  it("sets a switch and returns the new state", async () => {
    const res = await PATCH(patch({ deploySuccess: true }), ctxFor());
    expect(res.status).toBe(200);
    expect((await res.json()).statistics).toMatchObject({ deploySuccess: true, deployCount: false });
    const read = await GET(new NextRequest(`http://localhost/api/projects/${projectId}/statistics`), ctxFor());
    expect((await read.json()).statistics.deploySuccess).toBe(true);
  });

  it("refuses an unknown key with 400", async () => {
    const res = await PATCH(patch({ visitors: true, clicks: true }), ctxFor());
    expect(res.status).toBe(400);
  });

  it("refuses a different account with 404", async () => {
    session.userId = "stats-route-other";
    const res = await PATCH(patch({ visitors: true }), ctxFor());
    expect(res.status).toBe(404);
  });
});

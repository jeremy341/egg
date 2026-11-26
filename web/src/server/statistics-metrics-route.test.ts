import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { upsertUser } from "@/server/auth/session";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { updateStatistics } from "@/server/statistics";
import { useFreshDb } from "@/server/test/db";

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/server/http", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/http")>();
  return {
    ...real,
    authed: async () => {
      if (!session.userId) throw new real.HttpError(401, "Sign in required", "unauthorized");
      return { id: session.userId };
    },
  };
});

import { GET } from "@/app/api/projects/[id]/statistics/metrics/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let projectId: string;
let ownerId: string;
let otherId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  ownerId = (await upsertUser({ id: "smr-owner", name: "Sam", email: null, slackId: null })).id;
  otherId = (await upsertUser({ id: "smr-other", name: "Alex", email: null, slackId: null })).id;
  const serverId = (await createServer(ownerId, "smr-owner")).id;
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

const url = (query = "") => new NextRequest(`http://localhost/api/projects/${projectId}/statistics/metrics${query}`);
const ctxFor = (id = projectId) => ({ params: Promise.resolve({ id }) });

describe("statistics metrics API route", () => {
  it("refuses a request with no signed-in account with 401", async () => {
    session.userId = "";
    const res = await GET(url("?range=7d"), ctxFor());
    expect(res.status).toBe(401);
  });

  it("refuses an account that cannot view the project with 404", async () => {
    session.userId = otherId;
    const res = await GET(url("?range=7d"), ctxFor());
    expect(res.status).toBe(404);
  });

  it("refuses a range outside 7d, 30d and 90d with 400", async () => {
    const res = await GET(url("?range=365d"), ctxFor());
    expect(res.status).toBe(400);
  });

  it("leaves out a statistic whose switch is off, rather than returning zeros", async () => {
    await updateStatistics(ownerId, projectId, { deployCount: true });
    const res = await GET(url("?range=7d"), ctxFor());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.range).toBe("7d");
    expect(body.days).toBe(7);
    expect(Object.keys(body.series)).toEqual(["deployCount"]);
    expect(body.series.deployCount).toHaveLength(7);
    expect(body.series).not.toHaveProperty("deploySuccess");
    expect(body.series).not.toHaveProperty("buildTime");
    expect(body.series).not.toHaveProperty("visitors");
  });

  it("returns an empty series object when every switch is off", async () => {
    await updateStatistics(ownerId, projectId, { deployCount: false });
    const res = await GET(url(), ctxFor());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.range).toBe("30d");
    expect(body.series).toEqual({});
  });
});

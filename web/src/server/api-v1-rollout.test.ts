import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { createApiToken, type Scope } from "@/server/api-tokens";
import { ENDPOINTS } from "@/server/api-v1";
import { apiGetRollout, ROLLOUT_MAX_WAIT_MS, ROLLOUT_POLL_MS } from "@/server/api-v1-rollout";
import { upsertUser } from "@/server/auth/session";
import { schema, getDb } from "@/server/db";
import { createProject, deployBranch } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import { GET as rolloutRoute } from "@/app/api/v1/deployments/[deploymentId]/rollout/route";
import { POST as rollbackRoute } from "@/app/api/v1/deployments/[deploymentId]/rollback/route";
import type { Principal } from "@/server/api-tokens";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let me: { id: string };
let other: { id: string };
let deploymentId: string;
let theirDeploymentId: string;
let readerSecret: string;
let noReadSecret: string;
let writerSecret: string;

const principal = (userId: string, scopes: Scope[]): Principal => ({ userId, tokenId: "t", scopes });
const setState = async (id: string, state: "queued" | "ready") => {
  const db = await getDb();
  await db.update(schema.deployments).set({ state }).where(eq(schema.deployments.id, id));
};
const get = (secret: string | null, id: string, query = "") =>
  rolloutRoute(
    new NextRequest(`http://localhost:3000/api/v1/deployments/${id}/rollout${query}`, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }),
    { params: Promise.resolve({ deploymentId: id }) }
  );

beforeAll(async () => {
  ctx = await useFreshDb();
  me = await upsertUser({ id: "ro-1", name: "Sam", email: null, slackId: null });
  other = await upsertUser({ id: "ro-2", name: "Kim", email: null, slackId: null });
  const base = { repoUrl: "https://github.com/sam/roll.git", runtime: "node" as const };
  const serverId = (await createServer(me.id, "ro-sam")).id;
  const projectId = (await createProject(me.id, { ...base, serverId, name: "Roll", slug: "roll", port: 3920 })).id;
  deploymentId = (await deployBranch(me.id, projectId)).id;
  const theirServer = (await createServer(other.id, "ro-kim")).id;
  const theirProject = (await createProject(other.id, { ...base, serverId: theirServer, name: "Theirs", slug: "theirs-roll", port: 3921 })).id;
  theirDeploymentId = (await deployBranch(other.id, theirProject)).id;
  readerSecret = (await createApiToken(me.id, { name: "reader", scopes: ["deployments:read"] })).secret;
  noReadSecret = (await createApiToken(me.id, { name: "none", scopes: ["projects:read"] })).secret;
  writerSecret = (await createApiToken(me.id, { name: "writer", scopes: ["deployments:read", "deployments:write"] })).secret;
});
afterAll(async () => ctx.cleanup());

describe("the rollout endpoint, service level", () => {
  it("answers at once without wait, and does not sleep", async () => {
    let slept = 0;
    const out = await apiGetRollout(principal(me.id, ["deployments:read"]), deploymentId, false, {
      sleep: async () => {
        slept++;
      },
    });
    expect(out.rollout).toMatchObject({ done: false, waitedMs: 0, deployment: { id: deploymentId, state: "queued" } });
    expect(slept).toBe(0);
  });

  it("caps the wait at 60 seconds and gives up quietly when the rollout is still running", async () => {
    expect(ROLLOUT_MAX_WAIT_MS).toBe(60_000);
    let clock = 0;
    let slept = 0;
    const out = await apiGetRollout(principal(me.id, ["deployments:read"]), deploymentId, true, {
      waitMs: 10 * 60_000,
      pollMs: ROLLOUT_POLL_MS,
      now: () => clock,
      sleep: async (ms) => {
        slept += ms;
        clock += ms;
      },
    });
    expect(slept).toBe(60_000);
    expect(out.rollout).toMatchObject({ done: false, waitedMs: 60_000, deployment: { state: "queued" } });
  });

  it("stops waiting as soon as the deployment finishes", async () => {
    await setState(deploymentId, "queued");
    let clock = 0;
    let calls = 0;
    const out = await apiGetRollout(principal(me.id, ["deployments:read"]), deploymentId, true, {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
        calls++;
        if (calls === 3) await setState(deploymentId, "ready");
      },
    });
    expect(out.rollout).toMatchObject({ done: true, deployment: { state: "ready" } });
    expect(out.rollout.waitedMs).toBe(3 * ROLLOUT_POLL_MS);
    await setState(deploymentId, "queued");
  });

  it("needs the deployments:read scope before it reads anything", async () => {
    await expect(apiGetRollout(principal(me.id, ["projects:read"]), deploymentId, false)).rejects.toMatchObject({ status: 403 });
  });

  it("returns not found for another user's deployment", async () => {
    await expect(apiGetRollout(principal(me.id, ["deployments:read"]), theirDeploymentId, false)).rejects.toMatchObject({ status: 404 });
  });
});

describe("the rollout endpoint, over HTTP", () => {
  it("is listed as a read on deployments, with wait documented", () => {
    const ep = ENDPOINTS.find((e) => e.id === "get_rollout");
    expect(ep).toMatchObject({ method: "GET", path: "/deployments/{deploymentId}/rollout", scope: "deployments:read", bucket: "read" });
    expect(Object.keys(ep!.query)).toEqual(["wait"]);
  });

  it("returns the state without wait, for a token with the read scope", async () => {
    const res = await get(readerSecret, deploymentId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rollout).toMatchObject({ done: false, waitedMs: 0, deployment: { id: deploymentId } });
  });

  it("waits with wait=1 and returns as soon as the deployment is ready", async () => {
    await setState(deploymentId, "queued");
    const finish = setTimeout(() => void setState(deploymentId, "ready"), 300);
    const started = Date.now();
    const res = await get(readerSecret, deploymentId, "?wait=1");
    clearTimeout(finish);
    const body = await res.json();
    expect(body.rollout.done).toBe(true);
    expect(body.rollout.deployment.state).toBe("ready");
    expect(Date.now() - started).toBeLessThan(ROLLOUT_POLL_MS + 2_000);
    await setState(deploymentId, "queued");
  }, 15_000);

  it("refuses a token without the read scope with 403, and an unknown token with 401", async () => {
    expect((await get(noReadSecret, deploymentId)).status).toBe(403);
    expect((await get("egg_nope", deploymentId)).status).toBe(401);
  });
});

describe("rollback, watched through the rollout endpoint", () => {
  it("starts a rollback that the rollout endpoint can follow to completion", async () => {
    await setState(deploymentId, "ready");
    await ctx.db.update(schema.deployments).set({ isCurrent: false, cleanedUp: false }).where(eq(schema.deployments.id, deploymentId));
    const res = await rollbackRoute(
      new NextRequest(`http://localhost:3000/api/v1/deployments/${deploymentId}/rollback`, {
        method: "POST",
        headers: { authorization: `Bearer ${writerSecret}` },
      }),
      { params: Promise.resolve({ deploymentId }) }
    );
    expect(res.status).toBe(202);
    const rolledBack = (await res.json()).deployment as { id: string; source: string; state: string };
    expect(rolledBack).toMatchObject({ source: "rollback", state: "queued" });

    const watched = await get(writerSecret, rolledBack.id);
    expect((await watched.json()).rollout).toMatchObject({ done: false, deployment: { id: rolledBack.id, source: "rollback" } });
    await setState(deploymentId, "queued");
  });
});

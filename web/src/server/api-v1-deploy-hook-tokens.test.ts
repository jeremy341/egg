import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { callEndpoint, ENDPOINTS, endpointById } from "@/server/api-v1";
import type { Principal } from "@/server/api-tokens";
import { upsertUser } from "@/server/auth/session";
import { newId, sha256Hex } from "@/server/crypto";
import { schema } from "@/server/db";
import { triggerDeployHook } from "@/server/hooks";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let projectId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  const user = await upsertUser({ id: "deploy-hook-token-owner", name: "Token Owner", email: null, slackId: null });
  userId = user.id;
  const server = await createServer(userId, "hook-token-server");
  projectId = (await createProject(userId, {
    serverId: server.id,
    name: "Token App",
    slug: "token-app",
    repoUrl: "https://github.com/owner/token-app.git",
    runtime: "node",
    port: 3000,
  })).id;
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("named deploy-hook token endpoints", () => {
  const endpoints = new Map(ENDPOINTS.map((endpoint) => [endpoint.id, endpoint]));

  it("supports multiple named secrets while preserving legacy hook behavior", async () => {
    expect(endpoints.get("create_deploy_webhook_token")).toMatchObject({
      method: "POST",
      path: "/projects/{projectId}/hook/tokens",
      scope: "deployments:write",
      sensitive: true,
    });
    expect(endpoints.get("delete_deploy_webhook_token")).toMatchObject({
      method: "DELETE",
      path: "/projects/{projectId}/hook/tokens/{tokenId}",
      scope: "deployments:write",
      destructive: true,
    });

    const principal: Principal = {
      userId,
      tokenId: newId(),
      scopes: ["deployments:read", "deployments:write"],
    };
    const legacy = (await callEndpoint(principal, endpointById("rotate_deploy_hook")!, {
      projectId,
      confirmName: "Token App",
    })) as { hook: { url: string } };
    expect(legacy.hook.url).toContain("/api/hooks/deploy/ndh_");

    await expect(
      callEndpoint(principal, endpointById("create_deploy_webhook_token")!, { projectId }),
    ).rejects.toMatchObject({ status: 400 });

    const create = (name: string) => callEndpoint(principal, endpointById("create_deploy_webhook_token")!, { projectId, name }) as Promise<{
      token: { id: string; name: string; secret: string; createdAt: string };
    }>;
    const first = (await create("CI production")).token;
    const second = (await create("Preview builds")).token;

    expect(first).toMatchObject({ id: expect.any(String), name: "CI production", secret: expect.stringMatching(/^ndh_[A-Za-z0-9_-]+$/), createdAt: expect.any(String) });
    expect(second.id).not.toBe(first.id);
    for (const [id, secret] of [[first.id, first.secret], [second.id, second.secret]]) {
      const row = await ctx.db.select().from(schema.deployHookTokens).where(eq(schema.deployHookTokens.id, id)).get();
      expect(row?.hash).toBe(sha256Hex(secret));
      expect(JSON.stringify(row)).not.toContain(secret);
    }

    const list = (await callEndpoint(principal, endpointById("list_deploy_webhook_tokens")!, { projectId })) as {
      tokens: { id: string | null; name: string | null; active: boolean; createdAt: string | null }[];
    };
    expect(list.tokens).toEqual(expect.arrayContaining([
      { id: first.id, name: "CI production", active: true, createdAt: first.createdAt },
      { id: second.id, name: "Preview builds", active: true, createdAt: second.createdAt },
      expect.objectContaining({ id: null, name: null, active: true, createdAt: expect.any(String) }),
    ]));
    expect(JSON.stringify(list)).not.toContain(first.secret);
    expect(JSON.stringify(list)).not.toContain(second.secret);

    await expect(triggerDeployHook(first.secret, {})).resolves.toMatchObject({ projectId, source: "hook" });
    await expect(
      callEndpoint(principal, endpointById("delete_deploy_webhook_token")!, {
        projectId,
        tokenId: second.id,
        confirmName: "wrong name",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await ctx.db.select().from(schema.deployHookTokens).where(eq(schema.deployHookTokens.id, second.id))).toHaveLength(1);

    await callEndpoint(principal, endpointById("delete_deploy_webhook_token")!, {
      projectId,
      tokenId: first.id,
      confirmName: first.name,
    });
    await expect(triggerDeployHook(first.secret, {})).rejects.toMatchObject({ status: 404 });
    await callEndpoint(principal, endpointById("delete_deploy_webhook_token")!, {
      projectId,
      tokenId: second.id,
      confirmName: second.name,
    });

    await callEndpoint(principal, endpointById("revoke_deploy_hook")!, { projectId, confirmName: "Token App" });
    const empty = (await callEndpoint(principal, endpointById("list_deploy_webhook_tokens")!, { projectId })) as { tokens: unknown[] };
    expect(empty.tokens).toEqual([]);
  });
});

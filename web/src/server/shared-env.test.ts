import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { getCurrentUser } from "@/server/auth/current";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import { GET, POST, DELETE } from "@/app/api/projects/[id]/shared-env/route";
import { listSharedEnv, setSharedEnv, deleteSharedEnv } from "@/server/shared-env";
import { open } from "@/server/crypto";

vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn() }));

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let projectId: string;
let otherProjectId: string;
let ownerId: string;
let otherId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  const owner = await upsertUser({ id: "shared-env-owner", name: "Owner", email: null, slackId: null });
  const other = await upsertUser({ id: "shared-env-other", name: "Other", email: null, slackId: null });
  ownerId = owner.id;
  otherId = other.id;
  const server = await createServer(owner.id, "shared-env-server");
  const otherServer = await createServer(other.id, "shared-env-other-server");
  projectId = (await createProject(owner.id, { repoUrl: "https://github.com/a/b", runtime: "node", startCommand: "node server.js", serverId: server.id, name: "Shared", port: 3500 })).id;
  otherProjectId = (await createProject(other.id, { repoUrl: "https://github.com/a/c", runtime: "node", startCommand: "node server.js", serverId: otherServer.id, name: "Other", port: 3501 })).id;
});

afterAll(async () => ctx.cleanup());
beforeEach(async () => {
  await ctx.db.delete(schema.envVars);
  vi.mocked(getCurrentUser).mockResolvedValue(null);
});

const request = (method: string, url: string, body?: unknown) => new NextRequest(url, {
  method,
  headers: body === undefined ? undefined : { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("shared project environment variables", () => {
  it("encrypts values at rest and lists decrypted values only in their selected environment", async () => {
    await setSharedEnv(ownerId, projectId, "production", "API_TOKEN", "only-owner-value");
    await setSharedEnv(ownerId, projectId, "preview", "API_TOKEN", "preview-value");
    const rows = await ctx.db.select().from(schema.envVars).where(eq(schema.envVars.projectId, projectId));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.valueEnc)).not.toContain("only-owner-value");
    expect(rows[0].valueEnc).toMatch(/^v1\./);
    expect(await listSharedEnv(ownerId, projectId, "production")).toEqual([
      { key: "API_TOKEN", value: "only-owner-value", environment: "production" },
    ]);
    expect(() => open(rows[0].valueEnc, "wrong-context")).toThrow();
  });

  it("refuses non-owners and invalid environment names", async () => {
    await expect(listSharedEnv(otherId, projectId, "production")).rejects.toMatchObject({ status: 404 });
    await expect(setSharedEnv(ownerId, projectId, "staging" as never, "A", "b")).rejects.toMatchObject({ status: 400 });
  });

  it("deletes only the selected environment value", async () => {
    await setSharedEnv(ownerId, projectId, "production", "API_TOKEN", "prod");
    await setSharedEnv(ownerId, projectId, "preview", "API_TOKEN", "preview");
    await deleteSharedEnv(ownerId, projectId, "production", "API_TOKEN");
    expect(await listSharedEnv(ownerId, projectId, "production")).toEqual([]);
    expect(await listSharedEnv(ownerId, projectId, "preview")).toHaveLength(1);
    await expect(deleteSharedEnv(ownerId, projectId, "production", "API_TOKEN")).rejects.toMatchObject({ status: 404 });
  });

  it("exposes owner-only list, set and delete routes", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: ownerId, name: "Owner", email: null, hackClubId: ownerId } as never);
    expect((await POST(request("POST", "http://localhost/api", { environment: "production", key: "ROUTE_KEY", value: "route-secret" }), routeCtx(projectId))).status).toBe(201);
    const listed = await GET(request("GET", "http://localhost/api?environment=production"), routeCtx(projectId));
    expect(await listed.json()).toMatchObject({ env: [{ key: "ROUTE_KEY", value: "route-secret", environment: "production" }] });
    vi.mocked(getCurrentUser).mockResolvedValue({ id: otherId, name: "Other", email: null, hackClubId: otherId } as never);
    expect((await GET(request("GET", "http://localhost/api?environment=production"), routeCtx(projectId))).status).toBe(404);
    vi.mocked(getCurrentUser).mockResolvedValue({ id: ownerId, name: "Owner", email: null, hackClubId: ownerId } as never);
    expect((await DELETE(request("DELETE", "http://localhost/api?environment=production&key=ROUTE_KEY"), routeCtx(projectId))).status).toBe(200);
  });
});

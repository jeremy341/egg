import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { getCurrentUser } from "@/server/auth/current";
import type { OrgRole, ProjectRole } from "@/server/db/schema";

vi.mock("@/server/auth/current", () => ({
  getCurrentUser: vi.fn(),
  requireUser: vi.fn(),
}));

import { GET as getProject, PATCH as patchProject, DELETE as deleteProjectRoute } from "@/app/api/projects/[id]/route";
import { GET as getCleanup, POST as postCleanup } from "@/app/api/projects/[id]/cleanup/route";
import { GET as listEnv, POST as setEnv } from "@/app/api/projects/[id]/env/route";
import { GET as listDeployments } from "@/app/api/projects/[id]/deployments/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
const t0 = new Date("2026-11-01T12:00:00Z");
const USERS = ["owner", "pAdmin", "pMember", "pViewer", "stranger", "orgAdmin", "orgMember", "orgGuest"];
let seq = 0;

beforeAll(async () => {
  ctx = await useFreshDb();
  await ctx.db.insert(schema.users).values(
    USERS.map((id) => ({ id, hackClubId: id, name: id, email: `${id}@example.com`, emailVerified: true, createdAt: t0 }))
  );
  await ctx.db.insert(schema.servers).values({
    id: "srv",
    userId: "owner",
    nestUsername: "owner",
    host: "host",
    publicKey: "key",
    privateKeyEnc: "sealed",
    keyFingerprint: "fp",
    createdAt: t0,
  });
});
afterAll(async () => ctx.cleanup());
beforeEach(() => vi.mocked(getCurrentUser).mockResolvedValue(null));

function as(id: string) {
  vi.mocked(getCurrentUser).mockResolvedValue({ id, name: id, email: `${id}@example.com`, hackClubId: id } as never);
}

/** A project owned by `owner`. With `orgRoles`, it belongs to a new organization with those members. */
async function makeProject(members: [string, ProjectRole][], orgRoles: [string, OrgRole][] = []): Promise<string> {
  seq += 1;
  let orgId: string | null = null;
  if (orgRoles.length) {
    orgId = `pa-org${seq}`;
    await ctx.db.insert(schema.organizations).values({ id: orgId, name: `PA ${seq}`, slug: `pa-org-${seq}`, ownerId: "owner", createdAt: t0, updatedAt: t0 });
    await ctx.db.insert(schema.orgMembers).values([
      { orgId, userId: "owner", role: "owner", createdAt: t0 },
      ...orgRoles.map(([userId, role]) => ({ orgId: orgId as string, userId, role, createdAt: t0 })),
    ]);
  }
  const id = `pa${seq}`;
  await ctx.db.insert(schema.projects).values({
    id,
    userId: "owner",
    serverId: "srv",
    slug: `pa-${seq}`,
    name: `PA ${seq}`,
    repoUrl: "https://github.com/a/b",
    runtime: "node",
    port: 3000,
    orgId,
    createdAt: t0,
    updatedAt: t0,
  });
  if (members.length) {
    await ctx.db.insert(schema.projectMembers).values(members.map(([userId, role]) => ({ projectId: id, userId, role, createdAt: t0 })));
  }
  return id;
}

const ORIGIN = "http://localhost:3000";
function req(method: string, body?: unknown) {
  return new NextRequest(`${ORIGIN}/x`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("personal project: unchanged for the owner, closed to strangers", () => {
  it("the owner reads, renames and reads the env list; a stranger gets 404 everywhere", async () => {
    const p = await makeProject([]);
    as("owner");
    expect((await getProject(req("GET"), idCtx(p))).status).toBe(200);
    expect((await patchProject(req("PATCH", { name: "Renamed" }), idCtx(p))).status).toBe(200);
    expect((await listEnv(req("GET"), idCtx(p))).status).toBe(200);
    as("stranger");
    expect((await getProject(req("GET"), idCtx(p))).status).toBe(404);
    expect((await patchProject(req("PATCH", { name: "X" }), idCtx(p))).status).toBe(404);
    expect((await listEnv(req("GET"), idCtx(p))).status).toBe(404);
    expect((await listDeployments(req("GET"), idCtx(p))).status).toBe(404);
  });
});

describe("project roles on the migrated routes", () => {
  it("a viewer reads the project, its env names and deployments, but cannot edit, set env, clean up or delete", async () => {
    const p = await makeProject([["pViewer", "viewer"]]);
    as("pViewer");
    expect((await getProject(req("GET"), idCtx(p))).status).toBe(200);
    expect((await listEnv(req("GET"), idCtx(p))).status).toBe(200);
    expect((await listDeployments(req("GET"), idCtx(p))).status).toBe(200);
    expect((await getCleanup(req("GET"), idCtx(p))).status).toBe(200);
    expect((await patchProject(req("PATCH", { name: "Nope" }), idCtx(p))).status).toBe(403);
    expect((await setEnv(req("POST", { key: "A_KEY", value: "x" }), idCtx(p))).status).toBe(403);
    expect((await postCleanup(req("POST", { confirm: "x" }), idCtx(p))).status).toBe(403);
    expect((await deleteProjectRoute(req("DELETE"), idCtx(p))).status).toBe(403);
    const still = await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, p)).get();
    expect(still?.name).toBe("PA " + p.replace("pa", ""));
  });

  it("a member can edit and set env, but cannot delete or request cleanup (both need admin)", async () => {
    const p = await makeProject([["pMember", "member"]]);
    as("pMember");
    expect((await patchProject(req("PATCH", { name: "Edited by member" }), idCtx(p))).status).toBe(200);
    expect((await setEnv(req("POST", { key: "MEMBER_KEY", value: "x" }), idCtx(p))).status).toBe(201);
    expect((await deleteProjectRoute(req("DELETE"), idCtx(p))).status).toBe(403);
    expect((await postCleanup(req("POST", { confirm: "x" }), idCtx(p))).status).toBe(403);
    expect((await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, p)).get())).toBeTruthy();
  });

  it("an admin deletes the project records", async () => {
    const p = await makeProject([["pAdmin", "admin"]]);
    as("pAdmin");
    expect((await deleteProjectRoute(req("DELETE"), idCtx(p))).status).toBe(200);
    expect(await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, p)).get()).toBeUndefined();
  });
});

describe("organization roles on the migrated routes", () => {
  it("an organization admin without a project row manages the project; a member without one gets 404", async () => {
    const p = await makeProject([], [["orgAdmin", "admin"], ["orgMember", "member"], ["orgGuest", "guest"]]);
    as("orgAdmin");
    expect((await patchProject(req("PATCH", { name: "Org admin edit" }), idCtx(p))).status).toBe(200);
    as("orgMember");
    expect((await getProject(req("GET"), idCtx(p))).status).toBe(404);
    as("orgGuest");
    expect((await getProject(req("GET"), idCtx(p))).status).toBe(404);
  });

  it("an organization member with a viewer project role can read but not edit", async () => {
    const p = await makeProject([["orgMember", "viewer"]], [["orgMember", "member"]]);
    as("orgMember");
    expect((await getProject(req("GET"), idCtx(p))).status).toBe(200);
    expect((await patchProject(req("PATCH", { name: "Nope" }), idCtx(p))).status).toBe(403);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { getCurrentUser } from "@/server/auth/current";
import type { OrgRole, ProjectRole } from "@/server/db/schema";

vi.mock("@/server/auth/current", () => ({
  getCurrentUser: vi.fn(),
  requireUser: vi.fn(),
}));

import { GET as listMembers, POST as addMember } from "@/app/api/projects/[id]/members/route";
import { PATCH as setRole, DELETE as removeMember } from "@/app/api/projects/[id]/members/[userId]/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
const t0 = new Date("2026-11-01T12:00:00Z");
const USERS = ["owner", "pAdmin", "pMember", "pViewer", "stranger", "orgGuest", "orgMember", "newbie"];
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

/** A personal project owned by `owner`, with the given project roles. */
async function personalProject(members: [string, ProjectRole][]): Promise<string> {
  seq += 1;
  const id = `pp${seq}`;
  await ctx.db.insert(schema.projects).values({
    id,
    userId: "owner",
    serverId: "srv",
    slug: `pp-${seq}`,
    name: `PP ${seq}`,
    repoUrl: "https://github.com/a/b",
    runtime: "node",
    port: 3000,
    createdAt: t0,
    updatedAt: t0,
  });
  if (members.length) {
    await ctx.db.insert(schema.projectMembers).values(members.map(([userId, role]) => ({ projectId: id, userId, role, createdAt: t0 })));
  }
  return id;
}

/** An organization project owned by `owner`, with the given organization roles and project roles. */
async function orgProject(orgRoles: [string, OrgRole][], projectMembers: [string, ProjectRole][]): Promise<string> {
  seq += 1;
  const orgId = `morg${seq}`;
  await ctx.db.insert(schema.organizations).values({ id: orgId, name: `M ${seq}`, slug: `morg-${seq}`, ownerId: "owner", createdAt: t0, updatedAt: t0 });
  await ctx.db.insert(schema.orgMembers).values([{ orgId, userId: "owner", role: "owner", createdAt: t0 }, ...orgRoles.map(([userId, role]) => ({ orgId, userId, role, createdAt: t0 }))]);
  const id = await personalProject(projectMembers);
  await ctx.db.update(schema.projects).set({ orgId }).where(eq(schema.projects.id, id));
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
const memberCtx = (id: string, userId: string) => ({ params: Promise.resolve({ id, userId }) });

describe("GET /api/projects/[id]/members", () => {
  it("lists members for a viewer, and gives a stranger 404", async () => {
    const p = await personalProject([["pViewer", "viewer"]]);
    as("pViewer");
    const body = await (await listMembers(req("GET"), idCtx(p))).json();
    expect(body.members.map((m: { userId: string }) => m.userId)).toEqual(["pViewer"]);
    as("stranger");
    expect((await listMembers(req("GET"), idCtx(p))).status).toBe(404);
  });
});

describe("POST /api/projects/[id]/members", () => {
  it("refuses a project member without admin with 403", async () => {
    const p = await personalProject([["pMember", "member"]]);
    as("pMember");
    expect((await addMember(req("POST", { email: "newbie@example.com", role: "viewer" }), idCtx(p))).status).toBe(403);
  });

  it("refuses a stranger with 404", async () => {
    const p = await personalProject([]);
    as("stranger");
    expect((await addMember(req("POST", { email: "newbie@example.com", role: "viewer" }), idCtx(p))).status).toBe(404);
  });

  it("lets an admin add a person by email, in any case, with the chosen role", async () => {
    const p = await personalProject([["pAdmin", "admin"]]);
    as("pAdmin");
    const res = await addMember(req("POST", { email: "  NEWBIE@example.com ", role: "member" }), idCtx(p));
    expect(res.status).toBe(201);
    expect((await res.json()).member).toMatchObject({ userId: "newbie", role: "member" });
  });

  it("refuses an unknown email with 404, the owner with 400, and a duplicate with 409", async () => {
    const p = await personalProject([["pAdmin", "admin"], ["pViewer", "viewer"]]);
    as("pAdmin");
    expect((await addMember(req("POST", { email: "nobody@example.com", role: "viewer" }), idCtx(p))).status).toBe(404);
    expect((await addMember(req("POST", { email: "owner@example.com", role: "viewer" }), idCtx(p))).status).toBe(400);
    expect((await addMember(req("POST", { email: "pViewer@example.com", role: "member" }), idCtx(p))).status).toBe(409);
  });

  it("refuses an unknown project role with 400", async () => {
    const p = await personalProject([["pAdmin", "admin"]]);
    as("pAdmin");
    expect((await addMember(req("POST", { email: "newbie@example.com", role: "owner" }), idCtx(p))).status).toBe(400);
  });

  it("on an organization project, refuses a person who is not in the organization with 400", async () => {
    const p = await orgProject([["orgMember", "member"], ["pAdmin", "member"]], [["pAdmin", "admin"]]);
    as("pAdmin");
    expect((await addMember(req("POST", { email: "newbie@example.com", role: "viewer" }), idCtx(p))).status).toBe(400);
  });

  it("on an organization project, adds someone who is in the organization", async () => {
    const p = await orgProject([["orgGuest", "guest"], ["pAdmin", "member"]], [["pAdmin", "admin"]]);
    as("pAdmin");
    expect((await addMember(req("POST", { email: "orgGuest@example.com", role: "viewer" }), idCtx(p))).status).toBe(201);
  });
});

describe("PATCH /api/projects/[id]/members/[userId]", () => {
  it("refuses a project member without admin with 403", async () => {
    const p = await personalProject([["pMember", "member"], ["pViewer", "viewer"]]);
    as("pMember");
    expect((await setRole(req("PATCH", { role: "admin" }), memberCtx(p, "pViewer"))).status).toBe(403);
  });

  it("lets an admin change a role, and refuses an unknown role with 400", async () => {
    const p = await personalProject([["pAdmin", "admin"], ["pViewer", "viewer"]]);
    as("pAdmin");
    expect((await setRole(req("PATCH", { role: "member" }), memberCtx(p, "pViewer"))).status).toBe(200);
    expect((await setRole(req("PATCH", { role: "owner" }), memberCtx(p, "pViewer"))).status).toBe(400);
    const row = await ctx.db
      .select()
      .from(schema.projectMembers)
      .where(and(eq(schema.projectMembers.projectId, p), eq(schema.projectMembers.userId, "pViewer")))
      .get();
    expect(row?.role).toBe("member");
  });

  it("refuses a target who is not a member with 404, including the owner", async () => {
    const p = await personalProject([["pAdmin", "admin"]]);
    as("pAdmin");
    expect((await setRole(req("PATCH", { role: "viewer" }), memberCtx(p, "owner"))).status).toBe(404);
    expect((await setRole(req("PATCH", { role: "viewer" }), memberCtx(p, "stranger"))).status).toBe(404);
  });

  it("gives a stranger 404", async () => {
    const p = await personalProject([["pViewer", "viewer"]]);
    as("stranger");
    expect((await setRole(req("PATCH", { role: "admin" }), memberCtx(p, "pViewer"))).status).toBe(404);
  });
});

describe("DELETE /api/projects/[id]/members/[userId]", () => {
  it("refuses a project member without admin with 403, and leaves the membership", async () => {
    const p = await personalProject([["pMember", "member"], ["pViewer", "viewer"]]);
    as("pMember");
    expect((await removeMember(req("DELETE"), memberCtx(p, "pViewer"))).status).toBe(403);
    const row = await ctx.db
      .select()
      .from(schema.projectMembers)
      .where(and(eq(schema.projectMembers.projectId, p), eq(schema.projectMembers.userId, "pViewer")))
      .get();
    expect(row).toBeTruthy();
  });

  it("lets an admin remove a member, after which the person has no access", async () => {
    const p = await personalProject([["pAdmin", "admin"], ["pViewer", "viewer"]]);
    as("pAdmin");
    expect((await removeMember(req("DELETE"), memberCtx(p, "pViewer"))).status).toBe(200);
    as("pViewer");
    expect((await listMembers(req("GET"), idCtx(p))).status).toBe(404);
  });

  it("refuses a target who is not a member with 404", async () => {
    const p = await personalProject([["pAdmin", "admin"]]);
    as("pAdmin");
    expect((await removeMember(req("DELETE"), memberCtx(p, "stranger"))).status).toBe(404);
  });
});

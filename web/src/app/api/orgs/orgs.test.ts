import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { getCurrentUser } from "@/server/auth/current";
import { resolveProjectAccess } from "@/server/permissions";
import type { OrgRole } from "@/server/db/schema";

vi.mock("@/server/auth/current", () => ({
  getCurrentUser: vi.fn(),
  requireUser: vi.fn(),
}));

import { GET as listOrgs, POST as createOrg } from "@/app/api/orgs/route";
import { GET as getOrg, PATCH as renameOrg } from "@/app/api/orgs/[id]/route";
import { GET as listMembers } from "@/app/api/orgs/[id]/members/route";
import { PATCH as setRole, DELETE as removeMember } from "@/app/api/orgs/[id]/members/[userId]/route";
import { POST as leaveOrg } from "@/app/api/orgs/[id]/leave/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
const t0 = new Date("2026-11-01T12:00:00Z");
const USERS = ["owner", "admin", "member", "guest", "stranger", "target"];
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

/** Sign in as one user for the next request. */
function as(id: string | null) {
  vi.mocked(getCurrentUser).mockResolvedValue(
    id ? ({ id, name: id, email: `${id}@example.com`, hackClubId: id } as never) : null
  );
}

/** An organization with the given members. Each call gets its own org, so tests do not share state. */
async function makeOrg(members: [string, OrgRole][]): Promise<string> {
  seq += 1;
  const id = `org${seq}`;
  await ctx.db.insert(schema.organizations).values({ id, name: `Org ${seq}`, slug: `org-${seq}`, ownerId: "owner", createdAt: t0, updatedAt: t0 });
  await ctx.db
    .insert(schema.orgMembers)
    .values(members.map(([userId, role]) => ({ orgId: id, userId, role, createdAt: t0 })));
  return id;
}

/** A project in the organization, owned by `owner`. */
async function addOrgProject(orgId: string, owner: string): Promise<string> {
  seq += 1;
  const id = `proj${seq}`;
  await ctx.db.insert(schema.projects).values({
    id,
    userId: owner,
    serverId: "srv",
    slug: `proj-${seq}`,
    name: `Project ${seq}`,
    repoUrl: "https://github.com/a/b",
    runtime: "node",
    port: 3000,
    orgId,
    createdAt: t0,
    updatedAt: t0,
  });
  return id;
}

const ORIGIN = "http://localhost:3000";
function req(method: string, path: string, body?: unknown) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const memberCtx = (id: string, userId: string) => ({ params: Promise.resolve({ id, userId }) });

describe("POST /api/orgs", () => {
  it("creates an organization for the signed-in user as owner", async () => {
    as("stranger");
    const res = await createOrg(req("POST", "/api/orgs", { name: "New Team" }));
    expect(res.status).toBe(201);
    const listed = await (await listOrgs(req("GET", "/api/orgs"))).json();
    expect(listed.organizations.find((o: { name: string }) => o.name === "New Team")?.role).toBe("owner");
  });

  it("refuses an empty name", async () => {
    as("stranger");
    expect((await createOrg(req("POST", "/api/orgs", { name: "   " }))).status).toBe(400);
  });

  it("refuses when not signed in", async () => {
    as(null);
    expect((await createOrg(req("POST", "/api/orgs", { name: "X" }))).status).toBe(401);
  });
});

describe("GET /api/orgs", () => {
  it("lists only the organizations the user belongs to, with their role", async () => {
    const org = await makeOrg([["member", "member"]]);
    as("member");
    const body = await (await listOrgs(req("GET", "/api/orgs"))).json();
    expect(body.organizations.map((o: { id: string }) => o.id)).toContain(org);
    expect(body.organizations.find((o: { id: string }) => o.id === org).role).toBe("member");
    as("stranger");
    const other = await (await listOrgs(req("GET", "/api/orgs"))).json();
    expect(other.organizations.map((o: { id: string }) => o.id)).not.toContain(org);
  });
});

describe("GET /api/orgs/[id]", () => {
  it("returns the organization to any member, guests included", async () => {
    const org = await makeOrg([["guest", "guest"]]);
    as("guest");
    const res = await getOrg(req("GET", `/api/orgs/${org}`), idCtx(org));
    expect(res.status).toBe(200);
    expect((await res.json()).organization.role).toBe("guest");
  });

  it("gives a non-member not found", async () => {
    const org = await makeOrg([["member", "member"]]);
    as("stranger");
    expect((await getOrg(req("GET", `/api/orgs/${org}`), idCtx(org))).status).toBe(404);
  });
});

describe("PATCH /api/orgs/[id] (rename)", () => {
  it("refuses a plain member with 403", async () => {
    const org = await makeOrg([["member", "member"]]);
    as("member");
    expect((await renameOrg(req("PATCH", `/api/orgs/${org}`, { name: "Renamed" }), idCtx(org))).status).toBe(403);
  });

  it("lets an admin rename, and refuses an empty name with 400", async () => {
    const org = await makeOrg([["admin", "admin"]]);
    as("admin");
    const ok = await renameOrg(req("PATCH", `/api/orgs/${org}`, { name: "Renamed" }), idCtx(org));
    expect(ok.status).toBe(200);
    expect((await ok.json()).organization.name).toBe("Renamed");
    expect((await renameOrg(req("PATCH", `/api/orgs/${org}`, { name: "" }), idCtx(org))).status).toBe(400);
  });

  it("gives a non-member not found", async () => {
    const org = await makeOrg([["member", "member"]]);
    as("stranger");
    expect((await renameOrg(req("PATCH", `/api/orgs/${org}`, { name: "X" }), idCtx(org))).status).toBe(404);
  });
});

describe("GET /api/orgs/[id]/members", () => {
  it("lists members for any member, and gives a non-member 404", async () => {
    const org = await makeOrg([["owner", "owner"], ["guest", "guest"]]);
    as("guest");
    const body = await (await listMembers(req("GET", `/api/orgs/${org}/members`), idCtx(org))).json();
    expect(body.members.map((m: { userId: string }) => m.userId).sort()).toEqual(["guest", "owner"]);
    as("stranger");
    expect((await listMembers(req("GET", `/api/orgs/${org}/members`), idCtx(org))).status).toBe(404);
  });
});

describe("PATCH /api/orgs/[id]/members/[userId] (role)", () => {
  it("refuses an admin with 403: only owners change roles", async () => {
    const org = await makeOrg([["admin", "admin"], ["member", "member"]]);
    as("admin");
    expect((await setRole(req("PATCH", "/x", { role: "guest" }), memberCtx(org, "member"))).status).toBe(403);
  });

  it("lets an owner change a member's role", async () => {
    const org = await makeOrg([["owner", "owner"], ["member", "member"]]);
    as("owner");
    expect((await setRole(req("PATCH", "/x", { role: "admin" }), memberCtx(org, "member"))).status).toBe(200);
    expect(await ctx.db.select().from(schema.orgMembers).where(and(eq(schema.orgMembers.orgId, org), eq(schema.orgMembers.userId, "member"))).get()).toMatchObject({ role: "admin" });
  });

  it("refuses demoting the last owner with 409", async () => {
    const org = await makeOrg([["owner", "owner"]]);
    as("owner");
    expect((await setRole(req("PATCH", "/x", { role: "admin" }), memberCtx(org, "owner"))).status).toBe(409);
  });

  it("allows demoting an owner when another owner remains", async () => {
    const org = await makeOrg([["owner", "owner"], ["target", "owner"]]);
    as("owner");
    expect((await setRole(req("PATCH", "/x", { role: "member" }), memberCtx(org, "target"))).status).toBe(200);
  });

  it("refuses an unknown role with 400 and a non-member target with 404", async () => {
    const org = await makeOrg([["owner", "owner"], ["member", "member"]]);
    as("owner");
    expect((await setRole(req("PATCH", "/x", { role: "superuser" }), memberCtx(org, "member"))).status).toBe(400);
    expect((await setRole(req("PATCH", "/x", { role: "guest" }), memberCtx(org, "stranger"))).status).toBe(404);
  });
});

describe("DELETE /api/orgs/[id]/members/[userId] (remove)", () => {
  it("refuses a plain member with 403", async () => {
    const org = await makeOrg([["member", "member"], ["guest", "guest"]]);
    as("member");
    expect((await removeMember(req("DELETE", "/x"), memberCtx(org, "guest"))).status).toBe(403);
  });

  it("lets an admin remove a guest", async () => {
    const org = await makeOrg([["admin", "admin"], ["guest", "guest"]]);
    as("admin");
    expect((await removeMember(req("DELETE", "/x"), memberCtx(org, "guest"))).status).toBe(200);
  });

  it("refuses an admin removing another admin, or an owner, with 403", async () => {
    const org = await makeOrg([["admin", "admin"], ["target", "admin"], ["owner", "owner"]]);
    as("admin");
    expect((await removeMember(req("DELETE", "/x"), memberCtx(org, "target"))).status).toBe(403);
    expect((await removeMember(req("DELETE", "/x"), memberCtx(org, "owner"))).status).toBe(403);
  });

  it("refuses removing yourself through this route, with 400", async () => {
    const org = await makeOrg([["admin", "admin"]]);
    as("admin");
    expect((await removeMember(req("DELETE", "/x"), memberCtx(org, "admin"))).status).toBe(400);
  });

  it("refuses removing someone who still owns a project in the org, with 409", async () => {
    const org = await makeOrg([["owner", "owner"], ["member", "member"]]);
    await addOrgProject(org, "member");
    as("owner");
    expect((await removeMember(req("DELETE", "/x"), memberCtx(org, "member"))).status).toBe(409);
  });

  it("drops the removed person's project roles along with their membership", async () => {
    const org = await makeOrg([["owner", "owner"], ["guest", "guest"]]);
    const project = await addOrgProject(org, "owner");
    await ctx.db.insert(schema.projectMembers).values({ projectId: project, userId: "guest", role: "admin", createdAt: t0 });
    as("owner");
    expect((await removeMember(req("DELETE", "/x"), memberCtx(org, "guest"))).status).toBe(200);
    expect(await resolveProjectAccess("guest", project)).toEqual({ view: false, edit: false, admin: false });
    const left = await ctx.db.select().from(schema.projectMembers).where(eq(schema.projectMembers.userId, "guest")).all();
    expect(left.find((r) => r.projectId === project)).toBeUndefined();
  });

  it("gives a target who is not a member 404", async () => {
    const org = await makeOrg([["owner", "owner"]]);
    as("owner");
    expect((await removeMember(req("DELETE", "/x"), memberCtx(org, "stranger"))).status).toBe(404);
  });
});

describe("POST /api/orgs/[id]/leave", () => {
  it("refuses an owner until they hand over the owner role, with 409", async () => {
    const org = await makeOrg([["owner", "owner"], ["target", "owner"]]);
    as("owner");
    expect((await leaveOrg(req("POST", "/x"), idCtx(org))).status).toBe(409);
  });

  it("refuses a member who still owns a project in the org, with 409", async () => {
    const org = await makeOrg([["member", "member"]]);
    await addOrgProject(org, "member");
    as("member");
    expect((await leaveOrg(req("POST", "/x"), idCtx(org))).status).toBe(409);
  });

  it("lets a guest leave, after which the organization is gone for them", async () => {
    const org = await makeOrg([["guest", "guest"]]);
    as("guest");
    expect((await leaveOrg(req("POST", "/x"), idCtx(org))).status).toBe(200);
    expect((await getOrg(req("GET", `/api/orgs/${org}`), idCtx(org))).status).toBe(404);
  });

  it("gives a non-member 404", async () => {
    const org = await makeOrg([["member", "member"]]);
    as("stranger");
    expect((await leaveOrg(req("POST", "/x"), idCtx(org))).status).toBe(404);
  });
});

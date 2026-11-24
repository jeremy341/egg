import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { getCurrentUser } from "@/server/auth/current";
import type { ProjectRole } from "@/server/db/schema";

vi.mock("@/server/auth/current", () => ({
  getCurrentUser: vi.fn(),
  requireUser: vi.fn(),
}));

import { POST as requestTransferRoute } from "@/app/api/projects/[id]/transfer/route";
import { GET as listTransfers } from "@/app/api/transfers/route";
import { POST as acceptRoute } from "@/app/api/transfers/[id]/accept/route";
import { POST as declineRoute } from "@/app/api/transfers/[id]/decline/route";
import { POST as cancelRoute } from "@/app/api/transfers/[id]/cancel/route";
import { POST as previewRoute } from "@/app/api/projects/[id]/move/preview/route";
import { POST as confirmRoute } from "@/app/api/projects/[id]/move/route";
import { removeProjectMember } from "@/server/project-members";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
const t0 = new Date("2026-11-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const USERS = ["owner", "recipient", "other", "stranger", "orgAdminA", "orgMemberA", "orgOwnerB", "orgAdminB"];
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
  await ctx.db.insert(schema.organizations).values([
    { id: "orgA", name: "A", slug: "tr-a", ownerId: "owner", createdAt: t0, updatedAt: t0 },
    { id: "orgB", name: "B", slug: "tr-b", ownerId: "orgOwnerB", createdAt: t0, updatedAt: t0 },
  ]);
  await ctx.db.insert(schema.orgMembers).values([
    { orgId: "orgA", userId: "owner", role: "owner", createdAt: t0 },
    { orgId: "orgA", userId: "orgAdminA", role: "admin", createdAt: t0 },
    { orgId: "orgA", userId: "orgMemberA", role: "member", createdAt: t0 },
    { orgId: "orgA", userId: "recipient", role: "member", createdAt: t0 },
    { orgId: "orgA", userId: "other", role: "member", createdAt: t0 },
    { orgId: "orgB", userId: "orgOwnerB", role: "owner", createdAt: t0 },
    { orgId: "orgB", userId: "orgAdminB", role: "admin", createdAt: t0 },
    { orgId: "orgB", userId: "owner", role: "admin", createdAt: t0 },
  ]);
});
afterAll(async () => ctx.cleanup());
beforeEach(() => vi.mocked(getCurrentUser).mockResolvedValue(null));

function as(id: string) {
  vi.mocked(getCurrentUser).mockResolvedValue({ id, name: id, email: `${id}@example.com`, hackClubId: id } as never);
}

/** A project owned by `owner`, optionally in an organization, with project members. */
async function project(orgId: string | null, members: [string, ProjectRole][]): Promise<string> {
  seq += 1;
  const id = `tp${seq}`;
  await ctx.db.insert(schema.projects).values({
    id,
    userId: "owner",
    serverId: "srv",
    slug: `tp-${seq}`,
    name: `TP ${seq}`,
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

/** The owner asks to transfer; returns the transfer id. */
async function request(projectId: string, toUserId: string): Promise<string> {
  as("owner");
  const res = await requestTransferRoute(req("POST", { toUserId }), idCtx(projectId));
  expect(res.status).toBe(201);
  return (await res.json()).transfer.id as string;
}

async function ownerOf(projectId: string) {
  return (await ctx.db.select({ userId: schema.projects.userId }).from(schema.projects).where(eq(schema.projects.id, projectId)).get())?.userId;
}

describe("POST /api/projects/[id]/transfer", () => {
  it("refuses a project admin who is not the owner, with 404 (not found, as for any owner-only action)", async () => {
    const p = await project(null, [["recipient", "admin"], ["other", "member"]]);
    as("recipient");
    expect((await requestTransferRoute(req("POST", { toUserId: "other" }), idCtx(p))).status).toBe(404);
  });

  it("refuses transferring to yourself with 400, and to a non-member with 400", async () => {
    const p = await project(null, [["recipient", "member"]]);
    as("owner");
    expect((await requestTransferRoute(req("POST", { toUserId: "owner" }), idCtx(p))).status).toBe(400);
    expect((await requestTransferRoute(req("POST", { toUserId: "stranger" }), idCtx(p))).status).toBe(400);
  });

  it("refuses a second request while one is waiting, with 409", async () => {
    const p = await project(null, [["recipient", "member"], ["other", "member"]]);
    await request(p, "recipient");
    as("owner");
    expect((await requestTransferRoute(req("POST", { toUserId: "other" }), idCtx(p))).status).toBe(409);
  });
});

describe("accept, decline and cancel", () => {
  it("lets only the recipient accept; the owner becomes a project admin and the recipient the owner", async () => {
    const p = await project(null, [["recipient", "member"]]);
    const id = await request(p, "recipient");
    as("other");
    expect((await acceptRoute(req("POST"), idCtx(id))).status).toBe(404);
    as("recipient");
    expect((await acceptRoute(req("POST"), idCtx(id))).status).toBe(200);
    expect(await ownerOf(p)).toBe("recipient");
    const prior = await ctx.db
      .select()
      .from(schema.projectMembers)
      .where(and(eq(schema.projectMembers.projectId, p), eq(schema.projectMembers.userId, "owner")))
      .get();
    expect(prior?.role).toBe("admin");
  });

  it("a second accept is refused with 410", async () => {
    const p = await project(null, [["recipient", "member"]]);
    const id = await request(p, "recipient");
    as("recipient");
    expect((await acceptRoute(req("POST"), idCtx(id))).status).toBe(200);
    expect((await acceptRoute(req("POST"), idCtx(id))).status).toBe(410);
  });

  it("an expired request cannot be accepted (410), and the owner keeps the project", async () => {
    const p = await project(null, [["recipient", "member"]]);
    const id = await request(p, "recipient");
    await ctx.db.update(schema.ownershipTransfers).set({ expiresAt: new Date(Date.now() - DAY) }).where(eq(schema.ownershipTransfers.id, id));
    as("recipient");
    expect((await acceptRoute(req("POST"), idCtx(id))).status).toBe(410);
    expect(await ownerOf(p)).toBe("owner");
  });

  it("refuses to accept when the recipient is no longer a project member, with 409", async () => {
    const p = await project(null, [["recipient", "member"]]);
    const id = await request(p, "recipient");
    await ctx.db.delete(schema.projectMembers).where(eq(schema.projectMembers.projectId, p));
    as("recipient");
    expect((await acceptRoute(req("POST"), idCtx(id))).status).toBe(409);
    expect(await ownerOf(p)).toBe("owner");
  });

  it("refuses to accept on an organization project after the recipient left the organization, with 409", async () => {
    const p = await project("orgA", [["orgMemberA", "member"]]);
    const id = await request(p, "orgMemberA");
    await ctx.db.delete(schema.orgMembers).where(and(eq(schema.orgMembers.orgId, "orgA"), eq(schema.orgMembers.userId, "orgMemberA")));
    as("orgMemberA");
    expect((await acceptRoute(req("POST"), idCtx(id))).status).toBe(409);
  });

  it("a decline keeps the owner, and the request cannot be accepted afterwards (410)", async () => {
    const p = await project(null, [["recipient", "member"]]);
    const id = await request(p, "recipient");
    as("recipient");
    expect((await declineRoute(req("POST"), idCtx(id))).status).toBe(200);
    expect((await acceptRoute(req("POST"), idCtx(id))).status).toBe(410);
    expect(await ownerOf(p)).toBe("owner");
  });

  it("the owner can cancel a pending request; the recipient cannot cancel it, and cannot accept it afterwards", async () => {
    const p = await project(null, [["recipient", "member"]]);
    const id = await request(p, "recipient");
    as("recipient");
    expect((await cancelRoute(req("POST"), idCtx(id))).status).toBe(404);
    as("owner");
    expect((await cancelRoute(req("POST"), idCtx(id))).status).toBe(200);
    as("recipient");
    expect((await acceptRoute(req("POST"), idCtx(id))).status).toBe(410);
  });

  it("lists only the signed-in recipient's pending requests", async () => {
    const p = await project(null, [["recipient", "member"]]);
    const id = await request(p, "recipient");
    as("recipient");
    const mine = await (await listTransfers(req("GET"))).json();
    expect(mine.transfers.map((t: { id: string }) => t.id)).toContain(id);
    as("other");
    const theirs = await (await listTransfers(req("GET"))).json();
    expect(theirs.transfers.map((t: { id: string }) => t.id)).not.toContain(id);
  });
});

describe("project move: preview, then confirm", () => {
  it("a project member without admin cannot preview a move, with 403", async () => {
    const p = await project("orgA", [["recipient", "member"]]);
    as("recipient");
    expect((await previewRoute(req("POST", { toOrgId: "orgB" }), idCtx(p))).status).toBe(403);
  });

  it("a stranger gets 404", async () => {
    const p = await project("orgA", []);
    as("stranger");
    expect((await previewRoute(req("POST", { toOrgId: "orgB" }), idCtx(p))).status).toBe(404);
  });

  it("the target organization needs admin from the actor, with 403", async () => {
    const p = await project("orgA", []);
    as("orgAdminA");
    expect((await previewRoute(req("POST", { toOrgId: "orgB" }), idCtx(p))).status).toBe(403);
  });

  it("refuses a move to the place the project already is, with 400", async () => {
    const p = await project("orgA", []);
    as("owner");
    expect((await previewRoute(req("POST", { toOrgId: "orgA" }), idCtx(p))).status).toBe(400);
  });

  it("a preview to a missing organization is 404", async () => {
    const p = await project("orgA", []);
    as("owner");
    expect((await previewRoute(req("POST", { toOrgId: "nope" }), idCtx(p))).status).toBe(404);
  });

  it("previews who would lose access, and confirms only with the digest from that preview", async () => {
    const p = await project("orgA", [["recipient", "member"], ["other", "viewer"]]);
    as("owner");
    const preview = (await (await previewRoute(req("POST", { toOrgId: "orgB" }), idCtx(p))).json()).preview;
    const losing = preview.losing.map((l: { userId: string }) => l.userId).sort();
    expect(losing).toEqual(["orgAdminA", "other", "recipient"].sort());
    expect(preview.backups).toEqual([]);

    // A wrong digest is refused and changes nothing.
    const wrong = await confirmRoute(req("POST", { toOrgId: "orgB", digest: "0".repeat(64) }), idCtx(p));
    expect(wrong.status).toBe(409);
    expect(await ctx.db.select({ orgId: schema.projects.orgId }).from(schema.projects).where(eq(schema.projects.id, p)).get()).toMatchObject({ orgId: "orgA" });

    const res = await confirmRoute(req("POST", { toOrgId: "orgB", digest: preview.digest }), idCtx(p));
    expect(res.status).toBe(200);
    expect(await ctx.db.select({ orgId: schema.projects.orgId }).from(schema.projects).where(eq(schema.projects.id, p)).get()).toMatchObject({ orgId: "orgB" });
  });

  it("refuses a confirm whose preview is stale (a member was removed in between), with 409", async () => {
    const p = await project("orgA", [["recipient", "member"], ["other", "viewer"]]);
    as("owner");
    const preview = (await (await previewRoute(req("POST", { toOrgId: "orgB" }), idCtx(p))).json()).preview;
    await removeProjectMember("owner", p, "other");
    const res = await confirmRoute(req("POST", { toOrgId: "orgB", digest: preview.digest }), idCtx(p));
    expect(res.status).toBe(409);
  });

  it("refuses a confirm without a well-formed digest, with 400", async () => {
    const p = await project("orgA", []);
    as("owner");
    expect((await confirmRoute(req("POST", { toOrgId: "orgB" }), idCtx(p))).status).toBe(400);
    expect((await confirmRoute(req("POST", { toOrgId: "orgB", digest: "short" }), idCtx(p))).status).toBe(400);
  });
});


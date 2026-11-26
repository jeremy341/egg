import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { confirmProjectMove, previewProjectMove } from "@/server/project-move";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
const t0 = new Date("2026-11-01T12:00:00Z");

async function orgOf(projectId: string) {
  return (await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get())?.orgId ?? null;
}

beforeAll(async () => {
  ctx = await useFreshDb();
  const ids = ["owner", "adminA", "memberA", "viewerA", "bothMember", "stranger", "adminB", "memberB"];
  await ctx.db.insert(schema.users).values(ids.map((id) => ({ id, hackClubId: id, name: id, email: `${id}@example.com`, createdAt: t0 })));
  await ctx.db.insert(schema.servers).values({ id: "s", userId: "owner", nestUsername: "owner", host: "host", publicKey: "key", privateKeyEnc: "sealed", keyFingerprint: "fp", createdAt: t0 });
  await ctx.db.insert(schema.organizations).values([
    { id: "orgA", name: "A", slug: "a", ownerId: "owner", createdAt: t0, updatedAt: t0 },
    { id: "orgB", name: "B", slug: "b", ownerId: "owner", createdAt: t0, updatedAt: t0 },
  ]);
  await ctx.db.insert(schema.orgMembers).values([
    { orgId: "orgA", userId: "owner", role: "owner", createdAt: t0 },
    { orgId: "orgA", userId: "adminA", role: "admin", createdAt: t0 },
    { orgId: "orgA", userId: "memberA", role: "member", createdAt: t0 },
    { orgId: "orgA", userId: "viewerA", role: "guest", createdAt: t0 },
    { orgId: "orgA", userId: "bothMember", role: "member", createdAt: t0 },
    { orgId: "orgB", userId: "owner", role: "owner", createdAt: t0 },
    { orgId: "orgB", userId: "adminB", role: "admin", createdAt: t0 },
    { orgId: "orgB", userId: "bothMember", role: "member", createdAt: t0 },
    { orgId: "orgB", userId: "memberB", role: "member", createdAt: t0 },
  ]);
  const base = { serverId: "s", repoUrl: "https://github.com/a/b", runtime: "node" as const, port: 3000, createdAt: t0, updatedAt: t0 };
  await ctx.db.insert(schema.projects).values([
    { ...base, id: "p", userId: "owner", slug: "p", name: "P", orgId: "orgA" },
    { ...base, id: "lonely", userId: "owner", slug: "lonely", name: "Lonely", orgId: null },
  ]);
  await ctx.db.insert(schema.projectMembers).values([
    { projectId: "p", userId: "memberA", role: "member", createdAt: t0 },
    { projectId: "p", userId: "viewerA", role: "viewer", createdAt: t0 },
    { projectId: "p", userId: "bothMember", role: "member", createdAt: t0 },
  ]);
});
afterAll(async () => ctx.cleanup());

describe("who may preview or move", () => {
  it("a project member without admin cannot move the project", async () => {
    await expect(previewProjectMove("memberA", "p", "orgB")).rejects.toMatchObject({ status: 403 });
    await expect(previewProjectMove("viewerA", "p", "orgB")).rejects.toMatchObject({ status: 403 });
  });

  it("a stranger gets not found", async () => {
    await expect(previewProjectMove("stranger", "p", "orgB")).rejects.toMatchObject({ status: 404 });
  });

  it("the target organization needs admin from the actor", async () => {
    // adminA is an admin of orgA only, so cannot bring the project into orgB.
    await expect(previewProjectMove("adminA", "p", "orgB")).rejects.toMatchObject({ status: 403 });
  });

  it("an unknown target organization is not found", async () => {
    await expect(previewProjectMove("owner", "p", "nope")).rejects.toMatchObject({ status: 404 });
  });

  it("moving to where the project already is is refused", async () => {
    await expect(previewProjectMove("owner", "p", "orgA")).rejects.toMatchObject({ status: 400 });
  });
});

describe("preview", () => {
  it("lists every person whose access would shrink, and no one whose access stays", async () => {
    const preview = await previewProjectMove("owner", "p", "orgB");
    const byUser = Object.fromEntries(preview.losing.map((c) => [c.userId, c]));
    // Org admin of orgA is not in orgB: admin access goes entirely.
    expect(byUser.adminA).toEqual({ userId: "adminA", before: "admin", after: "none", via: "org" });
    // Project member and viewer of orgA are not in orgB.
    expect(byUser.memberA).toEqual({ userId: "memberA", before: "edit", after: "none", via: "project" });
    expect(byUser.viewerA).toEqual({ userId: "viewerA", before: "view", after: "none", via: "project" });
    // In both orgs with the same project role: nothing changes, so not listed.
    expect(byUser.bothMember).toBeUndefined();
    // The owner keeps everything, so is never listed.
    expect(byUser.owner).toBeUndefined();
  });

  it("is read-only: the project stays where it was", async () => {
    await previewProjectMove("owner", "p", "orgB");
    expect(await orgOf("p")).toBe("orgA");
  });

  it("reports no backups, because the codebase has no backup feature", async () => {
    const preview = await previewProjectMove("owner", "p", "orgB");
    expect(preview.backups).toEqual([]);
  });

  it("moving a personal project into an org loses nobody's access", async () => {
    const preview = await previewProjectMove("owner", "lonely", "orgB");
    expect(preview.losing).toEqual([]);
  });

  it("moving out of an org to personal: an org admin can do it, and only the org admin loses access", async () => {
    // A personal project honours project roles directly, so the project members keep theirs.
    const preview = await previewProjectMove("adminA", "p", null);
    expect(preview.losing.map((c) => c.userId)).toEqual(["adminA"]);
    expect(preview.losing[0]).toMatchObject({ before: "admin", after: "none", via: "org" });
  });
});

describe("confirm", () => {
  it("refuses a stale digest and changes nothing", async () => {
    const preview = await previewProjectMove("owner", "lonely", "orgB");
    // Something changes after the preview: someone is added to the project.
    await ctx.db.insert(schema.projectMembers).values({ projectId: "lonely", userId: "stranger", role: "viewer", createdAt: t0 });
    await expect(confirmProjectMove("owner", "lonely", "orgB", preview.digest)).rejects.toMatchObject({ status: 409 });
    expect(await orgOf("lonely")).toBeNull();
    await ctx.db.delete(schema.projectMembers).where(eq(schema.projectMembers.userId, "stranger"));
  });

  it("applies the move when the digest matches the current preview", async () => {
    const preview = await previewProjectMove("owner", "lonely", "orgB");
    await expect(confirmProjectMove("owner", "lonely", "orgB", preview.digest)).resolves.toEqual({ fromOrgId: null, toOrgId: "orgB" });
    expect(await orgOf("lonely")).toBe("orgB");
  });

  it("a digest from one move cannot confirm a different move", async () => {
    const preview = await previewProjectMove("owner", "p", "orgB");
    await expect(confirmProjectMove("owner", "p", null, preview.digest)).rejects.toMatchObject({ status: 409 });
    expect(await orgOf("p")).toBe("orgA");
  });

  it("after a confirmed move, the people who lost access are denied at the server", async () => {
    const preview = await previewProjectMove("owner", "p", "orgB");
    await confirmProjectMove("owner", "p", "orgB", preview.digest);
    expect(await orgOf("p")).toBe("orgB");
    await expect(previewProjectMove("memberA", "p", "orgA")).rejects.toMatchObject({ status: 404 });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { acceptProjectInvitation, createProjectInvitation, getProjectRole, listProjectInvitations, removeProjectMember, setProjectMemberRole } from "@/server/project-roles";
import { speedSummary } from "@/server/analytics-speed";
import { deleteEnvVar, deployBranch, listEnvVars, setEnvVar } from "@/server/projects";
import { deploymentPage, projectMetrics, projectViews } from "@/server/queries";
import { apiDeployBranch, apiListProjects } from "@/server/api-v1";
import { apiListEnv } from "@/server/api-v1-more";
import { apiTerminalStatus } from "@/server/api-v1-shell";
import { runDeployJob, type PipelineDeps } from "@/server/deploy/pipeline";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
const now = new Date("2026-11-01T00:00:00Z");
beforeAll(async () => {
  ctx = await useFreshDb();
  await ctx.db.insert(schema.users).values([
    { id: "owner", hackClubId: "owner", name: "Owner", email: "owner@example.com", createdAt: now },
    { id: "invitee", hackClubId: "invitee", name: "Invitee", email: "Person@Example.com", emailVerified: true, createdAt: now },
    { id: "other", hackClubId: "other", name: "Other", email: "other@example.com", createdAt: now },
  ]);
  await ctx.db.insert(schema.servers).values({ id: "s", userId: "owner", nestUsername: "owner", host: "host", publicKey: "key", privateKeyEnc: "sealed", keyFingerprint: "fp", createdAt: now });
  await ctx.db.insert(schema.projects).values({ id: "p", userId: "owner", serverId: "s", slug: "p", name: "P", repoUrl: "https://github.com/a/b", runtime: "node", port: 3000, createdAt: now, updatedAt: now });
});
afterAll(async () => ctx.cleanup());

describe("project invitations and roles", () => {
  it("rejects mismatch, expiration and replay; stores no bearer token", async () => {
    const created = await createProjectInvitation("owner", "p", { email: " person@example.com ", role: "viewer" }, now);
    expect(JSON.stringify(await listProjectInvitations("owner", "p"))).not.toContain(created.token);
    expect(JSON.stringify(await ctx.db.select().from(schema.projectInvitations))).not.toContain(created.token);
    await expect(acceptProjectInvitation("other", created.token, now)).rejects.toMatchObject({ status: 404 });
    await expect(acceptProjectInvitation("invitee", created.token, new Date(now.getTime() + 8 * 86400000))).rejects.toMatchObject({ status: 404 });
    await acceptProjectInvitation("invitee", created.token, now);
    expect(await getProjectRole("invitee", "p")).toBe("viewer");
    await expect(acceptProjectInvitation("invitee", created.token, now)).rejects.toMatchObject({ status: 404 });
  });
  it("allows only the owner to change or revoke members and takes effect immediately", async () => {
    await expect(setProjectMemberRole("invitee", "p", "invitee", "developer")).rejects.toMatchObject({ status: 404 });
    await expect(removeProjectMember("owner", "p", "owner")).rejects.toMatchObject({ status: 404 });
    await setProjectMemberRole("owner", "p", "invitee", "developer");
    expect(await getProjectRole("invitee", "p")).toBe("developer");
    const outstanding = await createProjectInvitation("owner", "p", { email: "person@example.com", role: "developer" }, now);
    await removeProjectMember("owner", "p", "invitee");
    await expect(acceptProjectInvitation("invitee", outstanding.token, now)).rejects.toMatchObject({ status: 404 });
    expect(await getProjectRole("invitee", "p")).toBeNull();
    expect(await getProjectRole("owner", "p")).toBe("owner");
    expect((await ctx.db.select().from(schema.projectMembers).where(eq(schema.projectMembers.projectId, "p")))).toEqual([]);
  });
  it("grants viewer analytics and project reads, restricts writes, and revokes access immediately", async () => {
    const invite = await createProjectInvitation("owner", "p", { email: "person@example.com", role: "viewer" }, now);
    await acceptProjectInvitation("invitee", invite.token, now);
    expect((await projectViews("invitee")).map(p => p.id)).toEqual(["p"]);
    expect((await speedSummary("invitee", "p", 30, now)).reports).toBe(0);
    const token = { userId: "invitee", tokenId: "token", scopes: ["projects:read", "deployments:write"] as ("projects:read" | "deployments:write")[] };
    expect((await apiListProjects(token)).projects.map(p => p.id)).toEqual(["p"]);
    await expect(apiDeployBranch(token, "p")).rejects.toMatchObject({ status: 404 });
    await expect(deployBranch("invitee", "p")).rejects.toMatchObject({ status: 404 });
    await expect(setEnvVar("invitee", "p", { key: "SECRET", value: "secret" })).rejects.toMatchObject({ status: 404 });
    await setProjectMemberRole("owner", "p", "invitee", "developer");
    await expect(apiDeployBranch({ ...token, scopes: ["projects:read"] }, "p")).rejects.toMatchObject({ status: 403 });
    const queued = (await apiDeployBranch(token, "p")).deployment;
    expect(queued.projectId).toBe("p");
    await expect(apiListEnv({ userId: "invitee", tokenId: "token", scopes: ["env:read"] }, "p")).rejects.toMatchObject({ status: 404 });
    await expect(apiTerminalStatus({ userId: "invitee", tokenId: "token", scopes: ["terminal:use"] }, "p")).rejects.toMatchObject({ status: 404 });
    await expect(setEnvVar("invitee", "p", { key: "SECRET", value: "secret" })).rejects.toMatchObject({ status: 404 });
    await removeProjectMember("owner", "p", "invitee");
    expect((await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, queued.id)).get())?.state).toBe("canceled");
    await expect(speedSummary("invitee", "p", 30, now)).rejects.toMatchObject({ status: 404 });
    await expect(deployBranch("invitee", "p")).rejects.toMatchObject({ status: 404 });
    expect(await projectViews("invitee")).toEqual([]);
  });
  it("requires verified email, binds account invitations, and removes pending account invitations", async () => {
    await ctx.db.update(schema.users).set({ emailVerified: false }).where(eq(schema.users.id, "invitee"));
    const email = await createProjectInvitation("owner", "p", { email: "person@example.com", role: "viewer" }, now);
    await expect(acceptProjectInvitation("invitee", email.token, now)).rejects.toMatchObject({ status: 404 });
    const direct = await createProjectInvitation("owner", "p", { userId: "invitee", role: "viewer" }, now);
    await expect(acceptProjectInvitation("other", direct.token, now)).rejects.toMatchObject({ status: 404 });
    await acceptProjectInvitation("invitee", direct.token, now);
    await expect(acceptProjectInvitation("invitee", direct.token, now)).rejects.toMatchObject({ status: 404 });
    const pending = await createProjectInvitation("owner", "p", { userId: "invitee", role: "developer" }, now);
    await removeProjectMember("owner", "p", "invitee");
    await expect(acceptProjectInvitation("invitee", pending.token, now)).rejects.toMatchObject({ status: 404 });
    await ctx.db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.id, "invitee"));
  });
  it("rechecks membership before a queued deployment performs any build or remote work", async () => {
    await ctx.db.insert(schema.deployments).values({ id: "revoked-work", projectId: "p", triggeredBy: "other", env: "production", state: "queued", source: "manual", branch: "main", port: 3000, releaseId: "00000000-0000-4000-8000-000000000000", createdAt: now });
    await runDeployJob("revoked-work", {} as PipelineDeps);
    expect((await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, "revoked-work")).get())?.state).toBe("error");
  });
  it("caps active invitations and prunes expired invitations", async () => {
    const future = new Date(now.getTime() + 30 * 86400000);
    for (let i = 0; i < 20; i++) await createProjectInvitation("owner", "p", { userId: "other", role: "viewer" }, future);
    await expect(createProjectInvitation("owner", "p", { userId: "other", role: "viewer" }, future)).rejects.toMatchObject({ status: 409 });
    await expect(createProjectInvitation("owner", "p", { userId: "other", role: "viewer" }, new Date(future.getTime() + 8 * 86400000))).resolves.toBeDefined();
  });
  it("routes colliding shared slugs by project ID and permits shared metrics", async () => {
    await ctx.db.insert(schema.servers).values({ id: "s2", userId: "invitee", nestUsername: "invitee", host: "host", publicKey: "key", privateKeyEnc: "sealed", keyFingerprint: "fp", createdAt: now });
    await ctx.db.insert(schema.projects).values({ id: "own", userId: "invitee", serverId: "s2", slug: "p", name: "Own", repoUrl: "https://github.com/a/c", runtime: "node", port: 3000, createdAt: now, updatedAt: now });
    await ctx.db.insert(schema.projectMembers).values({ projectId: "p", userId: "invitee", role: "viewer", createdAt: now });
    expect((await projectViews("invitee")).map(p => [p.id, p.slug])).toEqual(expect.arrayContaining([["own", "p"], ["p", "~p"]]));
    expect(await projectMetrics("invitee", "p")).toEqual([]);
    await ctx.db.insert(schema.deployments).values({ id: "shared-dep", projectId: "p", env: "production", state: "ready", source: "manual", branch: "main", port: 3000, releaseId: "r", createdAt: now });
    expect((await deploymentPage("invitee", { projectId: "p" })).rows[0].projectSlug).toBe("~p");
    await removeProjectMember("owner", "p", "invitee");
  });
  it("does not change or delete environment values while cleanup is in progress", async () => {
    await setEnvVar("owner", "p", { key: "CONFIG", value: "before" });
    const [entry] = await listEnvVars("owner", "p");
    await ctx.db.insert(schema.cleanupJobs).values({ id: "cleanup", userId: "owner", projectId: "p", scope: "project", state: "running", requestedAt: now, notBefore: now, updatedAt: now });
    await expect(setEnvVar("owner", "p", { key: "CONFIG", value: "after" })).rejects.toMatchObject({ status: 409 });
    await expect(deleteEnvVar("owner", "p", entry.id)).rejects.toMatchObject({ status: 409 });
    expect(await listEnvVars("owner", "p")).toHaveLength(1);
  });
  it("reports an already-member accept without changing the role, and burns the invitation", async () => {
    const fresh = await createProjectInvitation("owner", "p", { userId: "invitee", role: "developer" }, now);
    expect(await acceptProjectInvitation("invitee", fresh.token, now)).toEqual({ projectId: "p", alreadyMember: false });
    expect(await getProjectRole("invitee", "p")).toBe("developer");
    const older = await createProjectInvitation("owner", "p", { userId: "invitee", role: "viewer" }, now);
    expect(await acceptProjectInvitation("invitee", older.token, now)).toEqual({ projectId: "p", alreadyMember: true });
    expect(await getProjectRole("invitee", "p")).toBe("developer");
    const used = (await ctx.db.select().from(schema.projectInvitations).where(eq(schema.projectInvitations.id, older.invitation.id)).get())?.acceptedAt;
    expect(used).not.toBeNull();
    await removeProjectMember("owner", "p", "invitee");
    expect(await getProjectRole("invitee", "p")).toBeNull();
  });
});

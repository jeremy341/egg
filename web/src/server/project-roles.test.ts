import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { getProjectRole, requireProjectRole } from "@/server/project-roles";
import { speedSummary } from "@/server/analytics-speed";
import { deleteEnvVar, deployBranch, listEnvVars, listProjects, setEnvVar } from "@/server/projects";
import { deploymentPage, projectViews } from "@/server/queries";
import { apiListProjects } from "@/server/api-v1";
import { runDeployJob, type PipelineDeps } from "@/server/deploy/pipeline";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
const now = new Date("2026-11-01T00:00:00Z");
beforeAll(async () => {
  ctx = await useFreshDb();
  await ctx.db.insert(schema.users).values([
    { id: "owner", hackClubId: "owner", name: "Owner", email: "owner@example.com", createdAt: now },
    { id: "other", hackClubId: "other", name: "Other", email: "other@example.com", createdAt: now },
  ]);
  await ctx.db.insert(schema.servers).values({ id: "s", userId: "owner", nestUsername: "owner", host: "host", publicKey: "key", privateKeyEnc: "sealed", keyFingerprint: "fp", createdAt: now });
  await ctx.db.insert(schema.projects).values({ id: "p", userId: "owner", serverId: "s", slug: "p", name: "P", repoUrl: "https://github.com/a/b", runtime: "node", port: 3000, createdAt: now, updatedAt: now });
});
afterAll(async () => ctx.cleanup());

describe("owner-only project access", () => {
  it("grants only the owner a role and fails closed for everyone else", async () => {
    expect(await getProjectRole("owner", "p")).toBe("owner");
    expect(await getProjectRole("other", "p")).toBeNull();
    expect(await getProjectRole("other", "missing")).toBeNull();
    await expect(requireProjectRole("owner", "p")).resolves.toBe("owner");
    await expect(requireProjectRole("other", "p")).rejects.toMatchObject({ status: 404 });
    await expect(requireProjectRole("owner", "p", "superadmin" as never)).rejects.toMatchObject({ status: 404 });
  });

  it("lists a project only for its owner, on every surface", async () => {
    expect((await projectViews("owner")).map((p) => p.id)).toContain("p");
    expect((await listProjects("owner")).map((p) => p.id)).toContain("p");
    expect(await projectViews("other")).toEqual([]);
    expect(await listProjects("other")).toEqual([]);
    expect((await apiListProjects({ userId: "other", tokenId: "token", scopes: ["projects:read"] })).projects).toEqual([]);
  });

  it("denies reads and writes to a non-owner", async () => {
    await expect(speedSummary("other", "p", 30, now)).rejects.toMatchObject({ status: 404 });
    await expect(deployBranch("other", "p")).rejects.toMatchObject({ status: 404 });
    await expect(setEnvVar("other", "p", { key: "SECRET", value: "secret" })).rejects.toMatchObject({ status: 404 });
    expect((await deploymentPage("other", { projectId: "p" })).rows).toEqual([]);
  });

  it("keeps slugs unprefixed when another user owns a project with the same slug", async () => {
    await ctx.db.insert(schema.servers).values({ id: "s2", userId: "other", nestUsername: "other", host: "host", publicKey: "key", privateKeyEnc: "sealed", keyFingerprint: "fp", createdAt: now });
    await ctx.db.insert(schema.projects).values({ id: "own", userId: "other", serverId: "s2", slug: "p", name: "Own", repoUrl: "https://github.com/a/c", runtime: "node", port: 3000, createdAt: now, updatedAt: now });
    expect((await projectViews("other")).map((p) => p.id)).toEqual(["own"]);
    expect((await projectViews("other"))[0].slug).toBe("p");
  });

  it("rechecks authorization before a queued deployment performs any build or remote work", async () => {
    await ctx.db.insert(schema.deployments).values({ id: "foreign-work", projectId: "p", triggeredBy: "other", env: "production", state: "queued", source: "manual", branch: "main", port: 3000, releaseId: "00000000-0000-4000-8000-000000000000", createdAt: now });
    await runDeployJob("foreign-work", {} as PipelineDeps);
    expect((await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, "foreign-work")).get())?.state).toBe("error");
  });

  it("does not change or delete environment values while cleanup is in progress", async () => {
    await setEnvVar("owner", "p", { key: "CONFIG", value: "before" });
    const [entry] = await listEnvVars("owner", "p");
    await ctx.db.insert(schema.cleanupJobs).values({ id: "cleanup", userId: "owner", projectId: "p", scope: "project", state: "running", requestedAt: now, notBefore: now, updatedAt: now });
    await expect(setEnvVar("owner", "p", { key: "CONFIG", value: "after" })).rejects.toMatchObject({ status: 409 });
    await expect(deleteEnvVar("owner", "p", entry.id)).rejects.toMatchObject({ status: 409 });
    expect(await listEnvVars("owner", "p")).toHaveLength(1);
  });
});

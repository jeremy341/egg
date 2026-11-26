import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { sha256Hex } from "@/server/crypto";
import { schema } from "@/server/db";
import { createBuildCredentialsForUser, verifyBuildCredential, revokeBuildCredentialsForUser, BUILD_CREDENTIAL_TTL_MS } from "@/server/builds/token";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let user: Awaited<ReturnType<typeof upsertUser>>;
let project: Awaited<ReturnType<typeof createProject>>;

beforeAll(async () => {
  ctx = await useFreshDb();
  user = await upsertUser({ id: "build-credential-owner", name: "Owner", email: null, slackId: null });
  const server = await createServer(user.id, "build-credential-nest");
  project = await createProject(user.id, {
    serverId: server.id, name: "Credentials", repoUrl: "https://github.com/example/credentials",
    runtime: "node", port: 4321, buildLocation: "github",
  });
});
afterAll(async () => ctx.cleanup());

describe("operation-scoped, expiring GitHub build credentials", () => {
  it("issues distinct hash-only upload and per-environment credentials", async () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const issued = await createBuildCredentialsForUser(user.id, project.id, now);
    expect(new Set([issued.uploadToken, issued.previewEnvToken, issued.productionEnvToken]).size).toBe(3);
    expect(issued.expiresAt.getTime() - now.getTime()).toBe(BUILD_CREDENTIAL_TTL_MS);
    expect(await verifyBuildCredential(issued.uploadToken, "upload", now)).toBe(project.id);
    expect(await verifyBuildCredential(issued.previewEnvToken, "env_preview", now)).toBe(project.id);
    expect(await verifyBuildCredential(issued.productionEnvToken, "env_production", now)).toBe(project.id);
    expect(await verifyBuildCredential(issued.previewEnvToken, "env_production", now)).toBeNull();
    const rows = await ctx.db.select().from(schema.buildCredentials).where(eq(schema.buildCredentials.projectId, project.id));
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.tokenHash)).toEqual(expect.arrayContaining([
      sha256Hex(issued.uploadToken), sha256Hex(issued.previewEnvToken), sha256Hex(issued.productionEnvToken),
    ]));
    expect(JSON.stringify(rows)).not.toContain(issued.uploadToken);
  });

  it("expires and atomically rotates all three credentials", async () => {
    const old = await createBuildCredentialsForUser(user.id, project.id, new Date("2026-11-10T12:00:00Z"));
    expect(await verifyBuildCredential(old.uploadToken, "upload", old.expiresAt)).toBeNull();
    const next = await createBuildCredentialsForUser(user.id, project.id, new Date("2026-11-11T12:00:00Z"));
    expect(await verifyBuildCredential(old.uploadToken, "upload", new Date("2026-11-11T12:00:00Z"))).toBeNull();
    expect(await verifyBuildCredential(next.uploadToken, "upload", new Date("2026-11-11T12:00:00Z"))).toBe(project.id);
    expect(await ctx.db.select().from(schema.buildCredentials).where(eq(schema.buildCredentials.projectId, project.id))).toHaveLength(3);
  });

  it("revokes the owner's build credentials and rejects another user's rotation", async () => {
    const issued = await createBuildCredentialsForUser(user.id, project.id);
    const other = await upsertUser({ id: "build-credential-stranger", name: "Stranger", email: null, slackId: null });
    await expect(createBuildCredentialsForUser(other.id, project.id)).rejects.toMatchObject({ status: 404 });
    await revokeBuildCredentialsForUser(user.id, project.id);
    expect(await verifyBuildCredential(issued.uploadToken, "upload")).toBeNull();
    expect(await verifyBuildCredential(issued.productionEnvToken, "env_production")).toBeNull();
    expect(await ctx.db.select().from(schema.buildCredentials).where(eq(schema.buildCredentials.projectId, project.id))).toHaveLength(0);
  });
});

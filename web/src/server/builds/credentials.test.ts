import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { sha256Hex } from "@/server/crypto";
import { schema } from "@/server/db";
import { authenticateUploadCredential, createBuildCredentials, createBuildCredentialsForUser, verifyBuildCredential, revokeBuildCredentialsForUser, BUILD_CREDENTIAL_TTL_MS } from "@/server/builds/token";
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
  it("issues distinct hash-only upload and variable credentials, one pair per environment", async () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const issued = await createBuildCredentialsForUser(user.id, project.id, now);
    expect(new Set([issued.previewUploadToken, issued.productionUploadToken, issued.previewEnvToken, issued.productionEnvToken]).size).toBe(4);
    expect(issued.expiresAt.getTime() - now.getTime()).toBe(BUILD_CREDENTIAL_TTL_MS);
    expect(await verifyBuildCredential(issued.previewUploadToken, "upload_preview", now)).toBe(project.id);
    expect(await verifyBuildCredential(issued.productionUploadToken, "upload_production", now)).toBe(project.id);
    // An upload credential works only for its own environment.
    expect(await verifyBuildCredential(issued.previewUploadToken, "upload_production", now)).toBeNull();
    expect(await verifyBuildCredential(issued.productionUploadToken, "upload_preview", now)).toBeNull();
    expect(await verifyBuildCredential(issued.previewEnvToken, "env_preview", now)).toBe(project.id);
    expect(await verifyBuildCredential(issued.productionEnvToken, "env_production", now)).toBe(project.id);
    expect(await verifyBuildCredential(issued.previewEnvToken, "env_production", now)).toBeNull();
    const rows = await ctx.db.select().from(schema.buildCredentials).where(eq(schema.buildCredentials.projectId, project.id));
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.tokenHash)).toEqual(expect.arrayContaining([
      sha256Hex(issued.previewUploadToken), sha256Hex(issued.productionUploadToken), sha256Hex(issued.previewEnvToken), sha256Hex(issued.productionEnvToken),
    ]));
    expect(JSON.stringify(rows)).not.toContain(issued.previewUploadToken);
  });

  it("authenticates each upload bearer as only its own deployment environment", async () => {
    const issued = await createBuildCredentialsForUser(user.id, project.id);

    await expect(
      authenticateUploadCredential(new Headers({ authorization: `Bearer ${issued.previewUploadToken}` }))
    ).resolves.toEqual({ projectId: project.id, environment: "preview" });
    await expect(
      authenticateUploadCredential(new Headers({ authorization: `Bearer ${issued.productionUploadToken}` }))
    ).resolves.toEqual({ projectId: project.id, environment: "production" });
    await expect(
      authenticateUploadCredential(new Headers({ authorization: `Bearer ${issued.previewEnvToken}` }))
    ).rejects.toMatchObject({ status: 401 });
  });

  it("invalidates legacy three-token environment credentials but accepts a newly issued four-token set", async () => {
    const now = new Date("2026-11-12T12:00:00Z");
    const expiresAt = new Date(now.getTime() + BUILD_CREDENTIAL_TTL_MS);
    const legacyPreviewEnv = `egg_build_env_preview_${"p".repeat(43)}`;
    const legacyProductionEnv = `egg_build_env_production_${"q".repeat(43)}`;
    const legacyUpload = `egg_build_upload_${"u".repeat(43)}`;
    await ctx.db.delete(schema.buildCredentials).where(eq(schema.buildCredentials.projectId, project.id));
    await ctx.db.insert(schema.buildCredentials).values([
      { id: "legacy-upload", projectId: project.id, scope: "upload" as never, tokenHash: sha256Hex(legacyUpload), createdAt: now, expiresAt },
      { id: "legacy-env-preview", projectId: project.id, scope: "env_preview", tokenHash: sha256Hex(legacyPreviewEnv), createdAt: now, expiresAt },
      { id: "legacy-env-production", projectId: project.id, scope: "env_production", tokenHash: sha256Hex(legacyProductionEnv), createdAt: now, expiresAt },
    ]);

    expect(await verifyBuildCredential(legacyPreviewEnv, "env_preview", now)).toBeNull();
    expect(await verifyBuildCredential(legacyProductionEnv, "env_production", now)).toBeNull();

    const current = await createBuildCredentials(project.id, now);
    expect(await verifyBuildCredential(current.previewUploadToken, "upload_preview", now)).toBe(project.id);
    expect(await verifyBuildCredential(current.productionUploadToken, "upload_production", now)).toBe(project.id);
    expect(await verifyBuildCredential(current.previewEnvToken, "env_preview", now)).toBe(project.id);
    expect(await verifyBuildCredential(current.productionEnvToken, "env_production", now)).toBe(project.id);
  });

  it("expires and atomically rotates all four credentials", async () => {
    const old = await createBuildCredentialsForUser(user.id, project.id, new Date("2026-11-10T12:00:00Z"));
    expect(await verifyBuildCredential(old.previewUploadToken, "upload_preview", old.expiresAt)).toBeNull();
    const next = await createBuildCredentialsForUser(user.id, project.id, new Date("2026-11-11T12:00:00Z"));
    expect(await verifyBuildCredential(old.previewUploadToken, "upload_preview", new Date("2026-11-11T12:00:00Z"))).toBeNull();
    expect(await verifyBuildCredential(next.previewUploadToken, "upload_preview", new Date("2026-11-11T12:00:00Z"))).toBe(project.id);
    expect(await ctx.db.select().from(schema.buildCredentials).where(eq(schema.buildCredentials.projectId, project.id))).toHaveLength(4);
  });

  it("revokes the owner's build credentials and rejects another user's rotation", async () => {
    const issued = await createBuildCredentialsForUser(user.id, project.id);
    const other = await upsertUser({ id: "build-credential-stranger", name: "Stranger", email: null, slackId: null });
    await expect(createBuildCredentialsForUser(other.id, project.id)).rejects.toMatchObject({ status: 404 });
    await revokeBuildCredentialsForUser(user.id, project.id);
    expect(await verifyBuildCredential(issued.previewUploadToken, "upload_preview")).toBeNull();
    expect(await verifyBuildCredential(issued.productionEnvToken, "env_production")).toBeNull();
    expect(await ctx.db.select().from(schema.buildCredentials).where(eq(schema.buildCredentials.projectId, project.id))).toHaveLength(0);
  });
});

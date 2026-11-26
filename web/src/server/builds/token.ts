import { and, eq, gt } from "drizzle-orm";
import { audit } from "@/server/audit";
import { authorizedBuildToken, BAD_BUILD_CREDENTIAL, type BuildCredentialScope } from "@/server/builds/authorization";
import { newId, randomToken, safeEqual, sha256Hex } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { getProjectForUser } from "@/server/projects";
import { assertRateRoom, clientIp, enforceRateLimit } from "@/server/rate-limit";

/*
 * Operation-scoped, expiring credentials for a build in GitHub Actions. A project has three at a time:
 * one that can only upload a release, one that can only read the preview build variables and one that
 * can only read the production ones. They are shown once, when they are made; only their SHA-256 is
 * stored. Making new ones replaces all three at once. They travel only in the Authorization header.
 */

/** How long a set of build credentials works after it is made: 90 days. */
export const BUILD_CREDENTIAL_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const SCOPE_PREFIX: Record<BuildCredentialScope, string> = {
  upload: "egg_build_upload_",
  env_preview: "egg_build_env_preview_",
  env_production: "egg_build_env_production_",
};

const SCOPES = Object.keys(SCOPE_PREFIX) as BuildCredentialScope[];

export type BuildCredentials = {
  uploadToken: string;
  previewEnvToken: string;
  productionEnvToken: string;
  createdAt: Date;
  expiresAt: Date;
};

/**
 * Make the three credentials for the project, replacing any earlier set in one transaction. The project's
 * old rows, expired ones included, are deleted in the same step.
 */
export async function createBuildCredentials(projectId: string, now = new Date()): Promise<BuildCredentials> {
  const expiresAt = new Date(now.getTime() + BUILD_CREDENTIAL_TTL_MS);
  const tokens = Object.fromEntries(SCOPES.map((scope) => [scope, SCOPE_PREFIX[scope] + randomToken(32)])) as Record<
    BuildCredentialScope,
    string
  >;
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.delete(schema.buildCredentials).where(eq(schema.buildCredentials.projectId, projectId));
    await tx.insert(schema.buildCredentials).values(
      SCOPES.map((scope) => ({
        id: newId(),
        projectId,
        scope,
        tokenHash: sha256Hex(tokens[scope]),
        createdAt: now,
        expiresAt,
      }))
    );
  });
  return {
    uploadToken: tokens.upload,
    previewEnvToken: tokens.env_preview,
    productionEnvToken: tokens.env_production,
    createdAt: now,
    expiresAt,
  };
}

/** The owner's way in: checks the project is theirs, makes the credentials and records that they were made. */
export async function createBuildCredentialsForUser(userId: string, projectId: string, now = new Date()) {
  const project = await getProjectForUser(userId, projectId);
  const made = await createBuildCredentials(project.id, now);
  await audit(userId, "build_credentials.create", project.id);
  return made;
}

/** Remove the project's build credentials. They stop working at once. */
export async function revokeBuildCredentialsForUser(userId: string, projectId: string) {
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();
  await db.delete(schema.buildCredentials).where(eq(schema.buildCredentials.projectId, project.id));
  await audit(userId, "build_credentials.revoke", project.id);
}

/**
 * The project this credential belongs to, or null. A credential that is the wrong shape, unknown, replaced,
 * expired or made for another operation all give the same null. It stops working at its expiry time exactly.
 */
export async function verifyBuildCredential(
  token: string,
  scope: BuildCredentialScope,
  now = new Date()
): Promise<string | null> {
  if (typeof token !== "string") return null;
  if (!authorizedBuildToken(new Headers({ authorization: `Bearer ${token}` }), scope)) return null;
  const hash = sha256Hex(token);
  const db = await getDb();
  const row = await db
    .select({ projectId: schema.buildCredentials.projectId, hash: schema.buildCredentials.tokenHash })
    .from(schema.buildCredentials)
    .where(
      and(
        eq(schema.buildCredentials.tokenHash, hash),
        eq(schema.buildCredentials.scope, scope),
        gt(schema.buildCredentials.expiresAt, now)
      )
    )
    .get();
  if (!row) return null;
  return safeEqual(row.hash, hash) ? row.projectId : null;
}

/** What the owner may see about a project's credentials: when each was made and when it stops working. Never a token or a hash. */
export type BuildCredentialInfo = { scope: BuildCredentialScope; createdAt: Date; expiresAt: Date; expired: boolean };

export async function buildCredentialInfoForUser(userId: string, projectId: string, now = new Date()): Promise<BuildCredentialInfo[]> {
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();
  const rows = await db
    .select({
      scope: schema.buildCredentials.scope,
      createdAt: schema.buildCredentials.createdAt,
      expiresAt: schema.buildCredentials.expiresAt,
    })
    .from(schema.buildCredentials)
    .where(eq(schema.buildCredentials.projectId, project.id));
  return SCOPES.flatMap((scope) => rows.filter((r) => r.scope === scope)).map((r) => ({
    scope: r.scope,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    expired: r.expiresAt.getTime() <= now.getTime(),
  }));
}

/**
 * For the two public build routes: the project the Authorization bearer belongs to, or a 401 that does not say
 * which part was wrong. An address that keeps sending credentials that are not valid is turned away, like the API.
 */
export async function authenticateBuildCredential(headers: Headers, scope: BuildCredentialScope): Promise<string> {
  const ip = clientIp(headers);
  if (ip) assertRateRoom("badToken", ip);
  const token = authorizedBuildToken(headers, scope);
  const projectId = token ? await verifyBuildCredential(token, scope) : null;
  if (!projectId) {
    if (ip) enforceRateLimit("badToken", ip);
    throw new HttpError(401, BAD_BUILD_CREDENTIAL, "unauthorized");
  }
  return projectId;
}

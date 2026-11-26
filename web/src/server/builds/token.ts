import { and, eq, gt } from "drizzle-orm";
import { audit } from "@/server/audit";
import { authorizedBuildToken, BAD_BUILD_CREDENTIAL, type BuildCredentialScope } from "@/server/builds/authorization";
import { newId, randomToken, safeEqual, sha256Hex } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { getProjectForUser } from "@/server/projects";
import { assertRateRoom, clientIp, enforceRateLimit } from "@/server/rate-limit";

/*
 * Operation-scoped, expiring credentials for a build in GitHub Actions. A project has four at a time:
 * two that can only upload a release (one for preview deployments, one for production deployments) and
 * two that can only read the build variables (preview, production). The production pair is meant for a
 * GitHub Environment secret, so a workflow on a branch the environment does not allow never sees it; the
 * preview pair is a repository secret. They are shown once, when they are made; only their SHA-256 is
 * stored. Making new ones replaces all four at once. They travel only in the Authorization header.
 */

/** How long a set of build credentials works after it is made: 90 days. */
export const BUILD_CREDENTIAL_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const SCOPE_PREFIX: Record<BuildCredentialScope, string> = {
  upload_preview: "egg_build_upload_preview_",
  upload_production: "egg_build_upload_production_",
  env_preview: "egg_build_env_preview_",
  env_production: "egg_build_env_production_",
};

const SCOPES = Object.keys(SCOPE_PREFIX) as BuildCredentialScope[];

export type BuildCredentials = {
  previewUploadToken: string;
  productionUploadToken: string;
  previewEnvToken: string;
  productionEnvToken: string;
  createdAt: Date;
  expiresAt: Date;
};

/**
 * Make the four credentials for the project, replacing any earlier set in one transaction. The project's
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
    previewUploadToken: tokens.upload_preview,
    productionUploadToken: tokens.upload_production,
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
    .select({
      projectId: schema.buildCredentials.projectId,
      hash: schema.buildCredentials.tokenHash,
      createdAt: schema.buildCredentials.createdAt,
      expiresAt: schema.buildCredentials.expiresAt,
    })
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
  if (!safeEqual(row.hash, hash)) return null;

  // Before upload scopes were split, environment tokens had the same prefixes and remained valid for 90 days.
  // Require the matching environment upload scope from the same credential issuance so legacy three-token sets
  // stop working immediately, without invalidating a complete new set or changing the stored schema.
  const matchingUploadScope = scope === "env_preview" ? "upload_preview" : scope === "env_production" ? "upload_production" : null;
  if (matchingUploadScope) {
    const matchingUpload = await db
      .select({ id: schema.buildCredentials.id })
      .from(schema.buildCredentials)
      .where(
        and(
          eq(schema.buildCredentials.projectId, row.projectId),
          eq(schema.buildCredentials.scope, matchingUploadScope),
          eq(schema.buildCredentials.createdAt, row.createdAt),
          eq(schema.buildCredentials.expiresAt, row.expiresAt)
        )
      )
      .get();
    if (!matchingUpload) return null;
  }

  return row.projectId;
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

/** What an upload credential may upload: a build for a production deployment, or for a preview one. */
export type UploadEnvironment = "production" | "preview";

/**
 * For the upload route: the project the bearer belongs to and which environment its credential is for. Either
 * kind of upload credential is accepted here; the caller must keep the build to that environment.
 * A bad credential gets the same 401 as in `authenticateBuildCredential`.
 */
export async function authenticateUploadCredential(headers: Headers): Promise<{ projectId: string; environment: UploadEnvironment }> {
  const ip = clientIp(headers);
  if (ip) assertRateRoom("badToken", ip);
  for (const [scope, environment] of [
    ["upload_production", "production"],
    ["upload_preview", "preview"],
  ] as const) {
    const token = authorizedBuildToken(headers, scope);
    const projectId = token ? await verifyBuildCredential(token, scope) : null;
    if (projectId) return { projectId, environment };
  }
  if (ip) enforceRateLimit("badToken", ip);
  throw new HttpError(401, BAD_BUILD_CREDENTIAL, "unauthorized");
}

/**
 * For the public env route: the project the Authorization bearer belongs to, or a 401 that does not say
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

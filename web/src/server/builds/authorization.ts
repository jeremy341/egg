/**
 * A build credential always names the one operation it can perform. Uploading is split by environment: a
 * preview upload credential can only send a build for a preview deployment, a production one only for a
 * production deployment (see `acceptUpload`). The production ones belong in a GitHub Environment secret.
 */
export type BuildCredentialScope = "upload_preview" | "upload_production" | "env_preview" | "env_production";

/** The one answer for every bad credential: wrong scope, wrong shape, unknown, expired, revoked or replaced. */
export const BAD_BUILD_CREDENTIAL = "That build credential is not valid.";

const SHAPE: Record<BuildCredentialScope, RegExp> = {
  upload_preview: /^egg_build_upload_preview_[A-Za-z0-9_-]{43}$/,
  upload_production: /^egg_build_upload_production_[A-Za-z0-9_-]{43}$/,
  env_preview: /^egg_build_env_preview_[A-Za-z0-9_-]{43}$/,
  env_production: /^egg_build_env_production_[A-Za-z0-9_-]{43}$/,
};

/**
 * Extract only an operation-scoped bearer from the Authorization header.
 * Secrets in URLs can be copied into proxy, browser and analytics logs, so
 * build routes must not accept a path/query token as a fallback.
 */
export function authorizedBuildToken(headers: Headers, scope: BuildCredentialScope): string | null {
  const value = headers.get("authorization")?.trim();
  if (!value) return null;
  const match = /^Bearer ([^\s,]+)$/i.exec(value);
  if (!match || !SHAPE[scope].test(match[1])) return null;
  return match[1];
}

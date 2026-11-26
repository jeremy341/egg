import { normalizePath } from "@/server/files-paths";

/**
 * Egg writes runtime environment variables to `.env` in a release, and build
 * variables to `incoming/<release-id>.buildenv`. Neither may be returned by
 * the file manager or API, including through a symlink, with 403 `secret_file`.
 *
 * Pure, with no server imports, so the file manager's UI can use it too.
 */
const RELEASE_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SECRET_FILE = new RegExp(`^(?:(?:current|releases/[^/]+)/\\.env|incoming/${RELEASE_ID}\\.buildenv)$`);

export const SECRET_FILE_CODE = "secret_file";

/** True for a runtime or build environment file. A bad path is rejected separately. */
export function isSecretFile(raw: string): boolean {
  let path: string;
  try {
    path = normalizePath(raw);
  } catch {
    return false; // The file service reports a bad path itself.
  }
  return SECRET_FILE.test(path);
}

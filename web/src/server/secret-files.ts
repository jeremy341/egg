import { normalizePath } from "@/server/files-paths";

/**
 * Nest Deploy writes a release's environment variables, in plain text, to
 * `.env` at the top of the release (`current/.env`, `releases/<id>/.env`).
 * Values are write-only everywhere else, so neither the API nor the file
 * manager returns those files: both refuse them with 403 `secret_file`.
 * The check is by name, after the path rules. (A shell can still read them:
 * that is part of what the owner allows by turning the terminal on.)
 *
 * Pure, with no server imports, so the file manager's UI can use it too.
 */
const ENV_FILE = /^(?:current|releases\/[^/]+)\/\.env$/;

export const SECRET_FILE_CODE = "secret_file";

/** True for a path that names a release's `.env` file. A bad path is not one. */
export function isSecretFile(raw: string): boolean {
  let path: string;
  try {
    path = normalizePath(raw);
  } catch {
    return false; // The file service reports a bad path itself.
  }
  return ENV_FILE.test(path);
}

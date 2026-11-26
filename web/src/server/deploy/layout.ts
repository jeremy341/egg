/**
 * Where things live inside a Nest container, and what they are called.
 * Everything sits under one folder so removing Egg is one `rm -rf`
 * plus deleting the egg-*.service units.
 */

export const DEFAULT_UNIT_DIR = "/etc/systemd/system";
export const KEEP_RELEASES = 5;
export const KEEP_PREVIEWS = 2;

export function baseDir(home: string) {
  return `${home.replace(/\/$/, "")}/.egg`;
}

export function projectDir(home: string, slug: string) {
  return `${baseDir(home)}/${slug}`;
}

export function releaseDir(home: string, slug: string, releaseId: string) {
  return `${projectDir(home, slug)}/releases/${releaseId}`;
}

export function incomingArchive(home: string, slug: string, releaseId: string) {
  return `${projectDir(home, slug)}/incoming/${releaseId}.tar.gz`;
}

export function currentLink(home: string, slug: string) {
  return `${projectDir(home, slug)}/current`;
}

export function sharedDir(home: string, slug: string) {
  return `${projectDir(home, slug)}/shared`;
}

/** Every unit Egg writes starts with this. */
export const UNIT_PREFIX = "egg-";

/** systemd unit name. Production is egg-<slug>, previews add a short suffix. */
export function unitName(slug: string, preview?: { releaseId: string }) {
  return preview
    ? `${UNIT_PREFIX}${slug}-pv-${preview.releaseId.slice(0, 8)}.service`
    : `${UNIT_PREFIX}${slug}.service`;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isValidSlug(slug: string) {
  return SLUG.test(slug);
}

export function slugify(name: string) {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "project";
}

/** Release ids are UUIDs: safe in paths and easy to recognise when pruning. */
export const RELEASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * How Egg recognises what it created on a container. Anything without
 * a marker belongs to the user and is never overwritten, stopped or removed.
 *
 * A unit carries a comment line near the top. A project
 * folder carries a marker file; older folders are recognised by holding only
 * the entries we create (releases, incoming, shared, current) and no .git.
 */
export const UNIT_MARKER = "# egg:managed";
export const FOLDER_MARKER = ".egg-managed";

/** Shell helpers, ready to paste into a script. They only read. */
export const SH_MARKER_HELPERS =
  `egg_unit_marked() { [ -f "$1" ] && [ ! -L "$1" ] && grep -q '^${UNIT_MARKER}' "$1" 2>/dev/null; }\n` +
  `egg_dir_managed() { local d e n; d="$1"; [ -d "$d" ] && [ ! -L "$d" ] || return 1; [ -f "$d/${FOLDER_MARKER}" ] && return 0; [ -e "$d/.git" ] && return 1; ` +
  `n=0; for e in "$d"/* "$d"/.[!.]*; do [ -e "$e" ] || [ -L "$e" ] || continue; ` +
  `case "$(basename "$e")" in releases|incoming|shared|current|current.new) n=$((n+1));; *) return 1;; esac; done; [ "$n" -gt 0 ]; }\n`;

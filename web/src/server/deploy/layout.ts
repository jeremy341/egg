/**
 * Where things live inside a Nest container, and what they are called.
 * Everything sits under one folder so removing Egg is one `rm -rf`
 * plus deleting the egg-*.service units.
 */

import { createHash } from "node:crypto";

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

/**
 * Runtime variables live beside the release folders, never inside them: a release
 * folder is what a static app serves, so a file there can be fetched over HTTP.
 * `env/<release id>.env` is one release's file (mode 600, folder mode 700), and
 * `current.env` is a link to the file of the release `current` points at. The
 * production unit reads the link, so switching releases switches the variables.
 */
export function envDir(home: string, slug: string) {
  return `${projectDir(home, slug)}/env`;
}

export function envFileOf(home: string, slug: string, releaseId: string) {
  return `${envDir(home, slug)}/${releaseId}.env`;
}

export function currentEnvLink(home: string, slug: string) {
  return `${projectDir(home, slug)}/current.env`;
}

export function sharedDir(home: string, slug: string) {
  return `${projectDir(home, slug)}/shared`;
}

/** Every unit Egg writes starts with this. */
export const UNIT_PREFIX = "egg-";

/**
 * A short, stable discriminator derived from the server's id. systemd units,
 * Docker containers, images, Compose projects and their volumes are all
 * host-global: two Nest accounts whose servers point at the same host may pick
 * the same project slug. Folding the server id into every host-global name and
 * ownership marker keeps one account from taking over the other's resources.
 *
 * Eight hex characters (32 bits) keep names readable and well inside the
 * systemd (255 bytes) and Docker (255 chars) limits, even for a 39-char slug.
 */
export function serverDiscriminator(serverId: string): string {
  if (typeof serverId !== "string" || serverId.length === 0) throw new Error("A server id is required for a scoped name.");
  return createHash("sha256").update(serverId).digest("hex").slice(0, 8);
}

/** The slug as it appears in host-global names and markers: <slug>-<server scope>. */
export function scopedSlug(slug: string, scope?: string) {
  return scope ? `${slug}-${scope}` : slug;
}

/** systemd unit name. Production is egg-<slug>[-<scope>], previews add a short suffix. */
export function unitName(slug: string, preview?: { releaseId: string }, scope?: string) {
  const base = scopedSlug(slug, scope);
  return preview
    ? `${UNIT_PREFIX}${base}-pv-${preview.releaseId.slice(0, 8)}.service`
    : `${UNIT_PREFIX}${base}.service`;
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
  // Ownership, not just authorship: a unit belongs to the project and the *server*
  // its marker names. A unit from another account on the same host can share the
  // slug, so the scope (short hash of server.id) must match too. Units written
  // before the marker grew a project=/scope= carry neither and stay ours, as before.
  // Slugs and scopes are [a-z0-9-], so they are literal in this ERE.
  `egg_unit_ours() { local f="$1" slug="$2" scope="\${3-}" line marked_scope; egg_unit_marked "$f" || return 1; ` +
  `line=$(grep -m1 '^${UNIT_MARKER} project=' -- "$f" 2>/dev/null) || return 0; ` +
  `printf '%s\\n' "$line" | grep -qE "^${UNIT_MARKER} project="$slug"( |\\$)" || return 1; ` +
  `marked_scope=$(printf '%s\\n' "$line" | sed -nE 's/.* scope=([^ ]+).*/\\1/p'); ` +
  `[ -z "$marked_scope" ] || [ "$marked_scope" = "$scope" ]; }\n` +
  // The folder marker holds the same scope. Legacy empty markers still pass when
  // no scope is supplied, so folders written by older Egg versions stay ours.
  `egg_dir_managed() { local d="$1" scope="\${2-}" e n marked; [ -d "$d" ] && [ ! -L "$d" ] || return 1; ` +
  `if [ -f "$d/${FOLDER_MARKER}" ] && [ ! -L "$d/${FOLDER_MARKER}" ]; then ` +
  `if [ -n "$scope" ]; then read -r marked < "$d/${FOLDER_MARKER}" || marked=""; [ "$marked" = "$scope" ] || return 1; fi; return 0; fi; ` +
  `[ -e "$d/.git" ] && return 1; ` +
  `n=0; for e in "$d"/* "$d"/.[!.]*; do [ -e "$e" ] || [ -L "$e" ] || continue; ` +
  `case "$(basename "$e")" in releases|incoming|shared|env|current|current.new|current.env|current.env.new) n=$((n+1));; *) return 1;; esac; done; [ "$n" -gt 0 ]; }\n`;

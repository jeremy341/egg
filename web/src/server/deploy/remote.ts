import { shellQuote } from "@/server/ssh/connection";
import { removeManagedDownloadCache } from "@/server/deploy/download-cache";
import { APP_OOM_SCORE_ADJUST } from "@/server/deploy/container-build";
import {
  FOLDER_MARKER,
  RELEASE_ID,
  SH_MARKER_HELPERS,
  UNIT_MARKER,
  currentEnvLink,
  currentLink,
  envDir,
  envFileOf,
  projectDir,
  releaseDir,
  sharedDir,
} from "@/server/deploy/layout";

/**
 * Shell scripts that run on the Nest container (fed to `bash -s`). Every
 * interpolated value goes through shellQuote, and ids and slugs are validated
 * before they get here, so nothing user-supplied is ever left unquoted.
 */

const HEAD = "set -euo pipefail\n";

const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Shell helpers for the runtime variables files (see layout.ts: envFileOf). Releases made before
 * those files moved out of the release folder still have `<release>/.env`, which a static app
 * serves over HTTP. `egg_migrate_env` moves each into `env/<release id>.env`, points the units that
 * read it at the new path, and only then deletes the old file. It never fails the script that calls
 * it. Needs SH_MARKER_HELPERS' UNIT_MARKER; units are matched by the project name in their marker.
 */
export const SH_ENV_HELPERS =
  // Replace one exact line of a unit file, keeping its mode.
  `egg_fix_env() { local f="$1" old="$2" new="$3" t l; [ -f "$f" ] && [ ! -L "$f" ] || return 0; grep -qxF -- "$old" "$f" || return 0; t="$f.egg-tmp-$$"; ` +
  `while IFS= read -r l || [ -n "$l" ]; do if [ "$l" = "$old" ]; then printf '%s\\n' "$new"; else printf '%s\\n' "$l"; fi; done < "$f" > "$t" || { rm -f -- "$t"; return 0; }; ` +
  `chmod --reference="$f" -- "$t" 2>/dev/null || chmod 644 -- "$t"; mv -f -- "$t" "$f"; }\n` +
  // Copy a legacy file to its new place with mode 600, unless the new one already exists.
  `egg_env_copy() { local src="$1" dst="$2" t; [ -e "$dst" ] && return 0; [ -f "$src" ] && [ ! -L "$src" ] || return 1; t="$dst.tmp-$$"; ` +
  `( umask 077; cp -- "$src" "$t" ) && chmod 600 -- "$t" && mv -f -- "$t" "$dst"; }\n` +
  `egg_own_unit() { [ -f "$1" ] && [ ! -L "$1" ] && grep -qE "^${UNIT_MARKER} project=$2( |\\$)" "$1" 2>/dev/null; }\n` +
  `egg_migrate_env() {\n` +
  `  local p="$1" unitdir="$2" slug="$3" d id cur f legacy\n` +
  `  [ -d "$p/releases" ] || return 0\n` +
  `  mkdir -p -- "$p/env" && chmod 700 -- "$p/env" || return 0\n` +
  `  for d in "$p"/releases/*/; do\n` +
  `    d=\${d%/}; id=\${d##*/}\n` +
  `    [[ "$id" =~ ^${UUID_RE}$ ]] || continue\n` +
  `    [ -f "$d/.env" ] && [ ! -L "$d/.env" ] || continue\n` +
  `    egg_env_copy "$d/.env" "$p/env/$id.env" || continue\n` +
  `    for f in "$unitdir/egg-$slug-pv-"*.service; do egg_own_unit "$f" "$slug" && egg_fix_env "$f" "EnvironmentFile=$d/.env" "EnvironmentFile=$p/env/$id.env"; done\n` +
  `  done\n` +
  `  cur=$(readlink "$p/current" 2>/dev/null || true); id=\${cur##*/}\n` +
  `  if [[ "$id" =~ ^${UUID_RE}$ ]] && [ -f "$p/env/$id.env" ] && [ "$(readlink "$p/current.env" 2>/dev/null || true)" != "$p/env/$id.env" ]; then\n` +
  `    ln -sfn -- "$p/env/$id.env" "$p/current.env.new" && mv -Tf -- "$p/current.env.new" "$p/current.env"\n` +
  `  fi\n` +
  `  if [ -L "$p/current.env" ]; then\n` +
  `    for f in "$unitdir/egg-$slug.service" "$unitdir/egg-$slug-job-"*.service; do\n` +
  `      egg_own_unit "$f" "$slug" || continue\n` +
  `      egg_fix_env "$f" "EnvironmentFile=$p/current/.env" "EnvironmentFile=$p/current.env"\n` +
  `      egg_fix_env "$f" "EnvironmentFile=-$p/current/.env" "EnvironmentFile=-$p/current.env"\n` +
  `    done\n` +
  `  fi\n` +
  `  systemctl daemon-reload >/dev/null 2>&1 || true\n` +
  // A legacy file goes only once its copy exists and no unit of this project still names it.
  `  for d in "$p"/releases/*/; do\n` +
  `    d=\${d%/}; id=\${d##*/}; legacy="$d/.env"\n` +
  `    [[ "$id" =~ ^${UUID_RE}$ ]] || continue\n` +
  `    [ -f "$legacy" ] && [ ! -L "$legacy" ] && [ -f "$p/env/$id.env" ] || continue\n` +
  `    if grep -sqF -- "$legacy" "$unitdir"/egg-"$slug"*.service; then continue; fi\n` +
  `    if [ "$cur" = "$d" ] && grep -sqF -- "$p/current/.env" "$unitdir"/egg-"$slug"*.service; then continue; fi\n` +
  `    rm -f -- "$legacy" && echo "Moved the variables of release \${id:0:8} out of its folder"\n` +
  `  done\n` +
  `  return 0\n` +
  `}\n`;

export function migrateEnvCall(home: string, slug: string, unitDir: string) {
  return `egg_migrate_env ${shellQuote(projectDir(home, slug))} ${shellQuote(unitDir)} ${shellQuote(slug)} || true\n`;
}
/** Exit code when a folder or service on the container is not ours and must not be touched. */
export const NOT_OURS_EXIT = 30;

/**
 * Create the project's folders. Refuses (exit 30) when ~/.egg/<slug>
 * is a link, or holds something Egg did not put there, such as the
 * user's own git checkout. An empty folder is fine. Once created, the folder
 * gets a marker so later runs and the cleanup know it is ours.
 */
export function prepareDirs(home: string, slug: string) {
  const p = projectDir(home, slug);
  return (
    HEAD +
    SH_MARKER_HELPERS +
    `p=${shellQuote(p)}\n` +
    `if [ -L "$p" ]; then echo "$p is a link, so Egg will not write into it." >&2; exit ${NOT_OURS_EXIT}; fi\n` +
    `if [ -e "$p" ] && [ ! -d "$p" ]; then echo "$p exists and is not a folder." >&2; exit ${NOT_OURS_EXIT}; fi\n` +
    `if [ -d "$p" ] && ! egg_dir_managed "$p" && [ -n "$(ls -A "$p")" ]; then echo "$p already exists and was not created by Egg, so it was left alone." >&2; exit ${NOT_OURS_EXIT}; fi\n` +
    `e=${shellQuote(envDir(home, slug))}\n` +
    `if [ -L "$e" ] || { [ -e "$e" ] && [ ! -d "$e" ]; }; then echo "$e is not a folder, so Egg will not write variables into it." >&2; exit ${NOT_OURS_EXIT}; fi\n` +
    `mkdir -p ${shellQuote(`${p}/incoming`)} ${shellQuote(`${p}/releases`)} ${shellQuote(sharedDir(home, slug))}\n` +
    // Runtime variables live here, outside every release folder (a release folder can be served over HTTP).
    `mkdir -p "$e" && chmod 700 "$e"\n` +
    `: > ${shellQuote(`${p}/${FOLDER_MARKER}`)}\n`
  );
}

/**
 * Exit 30 when a service file with this name already exists and Egg
 * did not write it. Run before the unit is written, so a deploy never replaces
 * a service the user made.
 */
export function guardUnitFree(unitDir: string, unit: string) {
  return (
    HEAD +
    SH_MARKER_HELPERS +
    `f=${shellQuote(`${unitDir}/${unit}`)}\n` +
    `if { [ -e "$f" ] || [ -L "$f" ]; } && ! egg_unit_marked "$f"; then echo "${unit} already exists and was not created by Egg, so it was left alone." >&2; exit ${NOT_OURS_EXIT}; fi\n`
  );
}

/** systemd expands $VAR and %specifiers in ExecStart; double them so bash sees them. */
export function systemdEscape(value: string) {
  return value.replace(/\$/g, "$$$$").replace(/%/g, "%%");
}

export function unitFile(args: {
  slug: string;
  description: string;
  workDir: string;
  envFile: string;
  port: number;
  startCommand: string;
  /** Extra PATH entries, such as the Python venv. */
  pathPrefix?: string;
}) {
  const path = args.pathPrefix
    ? `Environment=PATH=${args.pathPrefix}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n`
    : "";
  return (
    `${UNIT_MARKER} project=${args.slug}\n` +
    `[Unit]\nDescription=${args.description.replace(/[\r\n]/g, " ")}\nAfter=network.target\n\n` +
    `[Service]\nType=simple\nWorkingDirectory=${args.workDir}\n` +
    `EnvironmentFile=${args.envFile}\n` +
    `Environment=PORT=${args.port}\nEnvironment=HOST=0.0.0.0\nEnvironment=NODE_ENV=production\n` +
    path +
    // login shell so tools installed with nvm and friends are on PATH
    `ExecStart=/bin/bash -lc ${JSON.stringify(systemdEscape(`exec ${args.startCommand}`))}\n` +
    `Restart=always\nRestartSec=3\n` +
    // The kernel's out-of-memory killer takes a build (which runs at +500) before this app.
    `OOMScoreAdjust=${APP_OOM_SCORE_ADJUST}\n\n` +
    `[Install]\nWantedBy=multi-user.target\n`
  );
}

export function installUnit(unitDir: string, unit: string) {
  return (
    HEAD +
    `[ -f ${shellQuote(`${unitDir}/${unit}`)} ]\n` +
    `systemctl daemon-reload\nsystemctl enable ${shellQuote(unit)} >/dev/null 2>&1 || true\n`
  );
}

/** Restore the production unit after cancellation/failure before activation. */
export function restoreUnit(unitDir: string, unit: string, content: string | null) {
  const file = `${unitDir}/${unit}`;
  const restore = content === null
    ? `rm -f ${shellQuote(file)}\nsystemctl disable ${shellQuote(unit)} >/dev/null 2>&1 || true\n`
    : `printf '%s' ${shellQuote(content)} > ${shellQuote(file)}\n`;
  return HEAD + restore + "systemctl daemon-reload\n";
}

/** Point `current` at a release (production) and restart the service. */
export function activateProduction(args: {
  home: string;
  slug: string;
  releaseId: string;
  unit: string;
  unitDir?: string;
  /** Desired unit content when restoring a prior deployment. */
  unitFile?: string | null;
  /** Unit content to restore if changing to this release cannot restart. */
  restoreUnitFile?: string | null;
}) {
  const link = currentLink(args.home, args.slug);
  const target = releaseDir(args.home, args.slug, args.releaseId);
  const envLink = currentEnvLink(args.home, args.slug);
  const envFile = envFileOf(args.home, args.slug, args.releaseId);
  const unitDir = args.unitDir ?? "/etc/systemd/system";
  const unitPath = `${unitDir}/${args.unit}`;
  const writeUnit = args.unitFile === undefined
    ? ""
    : args.unitFile === null
      ? `rm -f ${shellQuote(unitPath)}\nsystemctl daemon-reload\n`
      : `printf '%s' ${shellQuote(args.unitFile)} > ${shellQuote(unitPath)}\nsystemctl daemon-reload\n`;
  const restoreUnit = args.restoreUnitFile === undefined
    ? `if [ -n "$saved_unit" ]; then cp "$saved_unit" ${shellQuote(unitPath)}; else rm -f ${shellQuote(unitPath)}; fi\n`
    : args.restoreUnitFile === null
      ? `rm -f ${shellQuote(unitPath)}\nsystemctl disable ${shellQuote(args.unit)} >/dev/null 2>&1 || true\n`
      : `printf '%s' ${shellQuote(args.restoreUnitFile)} > ${shellQuote(unitPath)}\n`;
  // The target's variables file is made ready before anything is switched: the one in env/, or
  // (a release made before the files moved) a copy of its own .env. The unit then reads the
  // current.env link, which is switched together with `current`. The legacy file is deleted only
  // after the restart worked, by egg_migrate_env, so a failed switch can still go back.
  const prepareEnv =
    `mkdir -p ${shellQuote(envDir(args.home, args.slug))} && chmod 700 ${shellQuote(envDir(args.home, args.slug))}\n` +
    `egg_env_copy ${shellQuote(`${target}/.env`)} ${shellQuote(envFile)} || true\n` +
    `if [ ! -f ${shellQuote(envFile)} ]; then ( umask 077; : > ${shellQuote(envFile)} ); fi\n` +
    `old_env_link=$(readlink ${shellQuote(envLink)} 2>/dev/null || true)\n` +
    `ln -sfn ${shellQuote(envFile)} ${shellQuote(envLink + ".new")}\n` +
    `mv -Tf ${shellQuote(envLink + ".new")} ${shellQuote(envLink)}\n` +
    `egg_fix_env ${shellQuote(unitPath)} ${shellQuote(`EnvironmentFile=${link}/.env`)} ${shellQuote(`EnvironmentFile=${envLink}`)}\n` +
    `systemctl daemon-reload\n`;
  const restoreEnvLink =
    `  if [ -n "$old_env_link" ]; then ln -sfn "$old_env_link" ${shellQuote(envLink + ".new")} && mv -Tf ${shellQuote(envLink + ".new")} ${shellQuote(envLink)}; else rm -f ${shellQuote(envLink)}; fi\n`;
  return (
    HEAD +
    SH_MARKER_HELPERS +
    SH_ENV_HELPERS +
    `[ -d ${shellQuote(target)} ]\n` +
    `saved_unit=""\nif [ -f ${shellQuote(unitPath)} ]; then saved_unit=${shellQuote(unitPath)}.egg-previous-$$; cp ${shellQuote(unitPath)} "$saved_unit"; fi\n` +
    writeUnit +
    `old_link=$(readlink ${shellQuote(link)} 2>/dev/null || true)\n` +
    prepareEnv +
    `ln -sfn ${shellQuote(target)} ${shellQuote(link + ".new")}\n` +
    `mv -Tf ${shellQuote(link + ".new")} ${shellQuote(link)}\n` +
    `if ! systemctl restart ${shellQuote(args.unit)}; then\n` +
    `  if [ -n "$old_link" ]; then ln -sfn "$old_link" ${shellQuote(link + ".new")} && mv -Tf ${shellQuote(link + ".new")} ${shellQuote(link)}; else rm -f ${shellQuote(link)}; fi\n` +
    restoreEnvLink +
    `  ${restoreUnit.trim()}\n` +
    `  systemctl daemon-reload || true\n  systemctl restart ${shellQuote(args.unit)} || true\n` +
    `  [ -z "$saved_unit" ] || rm -f "$saved_unit"\n  exit 1\nfi\n` +
    `[ -z "$saved_unit" ] || rm -f "$saved_unit"\n` +
    `echo "Switched to release ${args.releaseId.slice(0, 8)} and restarted"\n` +
    migrateEnvCall(args.home, args.slug, unitDir)
  );
}

export function startUnit(unit: string) {
  return HEAD + `systemctl restart ${shellQuote(unit)}\necho "Started ${unit}"\n`;
}

/** Wait until the app answers on its port. Exit 0 healthy, 1 timed out, 2 crashed. */
export function healthCheck(args: {
  unit: string;
  port: number;
  path: string;
  timeoutSeconds: number;
}) {
  const path = args.path.startsWith("/") ? args.path : `/${args.path}`;
  return (
    `unit=${shellQuote(args.unit)}\nport=${Number(args.port)}\npath=${shellQuote(path)}\n` +
    `deadline=$((SECONDS + ${Number(args.timeoutSeconds)}))\n` +
    `while [ $SECONDS -lt $deadline ]; do\n` +
    `  state=$(systemctl is-active "$unit" 2>/dev/null || true)\n` +
    `  if [ "$state" = "failed" ]; then echo "Service crashed on start"; exit 2; fi\n` +
    `  if command -v curl >/dev/null 2>&1; then\n` +
    `    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$port$path" || true)\n` +
    `    case "$code" in [234]??) echo "Healthy: HTTP $code on port $port"; exit 0;; esac\n` +
    `  elif (exec 3<>/dev/tcp/127.0.0.1/$port) 2>/dev/null; then echo "Healthy: port $port is accepting connections"; exit 0; fi\n` +
    `  sleep 1\n` +
    `done\n` +
    `echo "No healthy response on port $port after ${Number(args.timeoutSeconds)}s"; exit 1\n`
  );
}

/**
 * `since` is a journalctl time such as "1 hour ago"; it is always shell-quoted.
 * `until` is whole seconds since the epoch: only entries up to then are read.
 */
export function journalTail(unit: string, lines = 40, since?: string, until?: number) {
  const window =
    (since ? ` --since ${shellQuote(since)}` : "") +
    (until !== undefined ? ` --until ${shellQuote(`@${Math.floor(Number(until))}`)}` : "");
  return (
    `journalctl -u ${shellQuote(unit)} -n ${Number(lines)}${window} --no-pager -o short-iso 2>&1 || true\n`
  );
}

/**
 * Delete release folders that are not in the keep list, the uploaded archives, and the build
 * variables files (`incoming/<release id>.buildenv`) of every release that is not being built
 * right now. A build removes its own variables file as soon as it has loaded it, so one that is
 * still here belongs to a build that was interrupted. `building` lists the release ids of builds
 * that may be running, and their files are never removed. Pruning runs after a deploy is
 * activated, and a project has one deploy at a time, so in practice that list is empty.
 */
export function pruneReleases(
  home: string,
  slug: string,
  keep: string[],
  building: string[] = [],
  /** When given, releases made before the variables files moved are brought to the new layout first. */
  unitDir?: string
) {
  const dir = `${projectDir(home, slug)}/releases`;
  const safeKeep = keep.filter((k) => RELEASE_ID.test(k));
  const safeBuilding = building.filter((k) => RELEASE_ID.test(k));
  const e = shellQuote(envDir(home, slug));
  // The variables file of a release that is gone (or never went live) goes with it. The one the
  // current.env link names stays, whatever the lists say.
  const pruneEnvFiles =
    `keepenv=" ${safeKeep.join(" ")} ${safeBuilding.join(" ")} "\n` +
    `liveenv=$(readlink ${shellQuote(currentEnvLink(home, slug))} 2>/dev/null || true)\n` +
    `for f in ${e}/*.env; do\n` +
    `  [ -f "$f" ] && [ ! -L "$f" ] || continue\n` +
    `  n=\${f##*/}; id=\${n%.env}\n` +
    `  [[ "$id" =~ ^${UUID_RE}$ ]] || continue\n` +
    `  [ "$f" = "$liveenv" ] && continue\n` +
    `  if [[ "$keepenv" != *" $id "* ]]; then rm -f -- "$f"; fi\n` +
    `done\n`;
  return (
    HEAD +
    (unitDir ? SH_MARKER_HELPERS + SH_ENV_HELPERS : "") +
    // The variables files go first: they are the only plaintext here, and the folder step below may exit early.
    `building=" ${safeBuilding.join(" ")} "\n` +
    `for f in ${shellQuote(`${projectDir(home, slug)}/incoming`)}/*.buildenv; do\n` +
    `  [ -e "$f" ] || [ -L "$f" ] || continue\n` +
    `  n=\${f##*/}; id=\${n%.buildenv}\n` +
    `  if [[ "$id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] && [[ "$building" != *" $id "* ]]; then rm -f -- "$f"; echo "Removed a leftover build variables file"; fi\n` +
    `done\n` +
    (unitDir ? migrateEnvCall(home, slug, unitDir) : "") +
    pruneEnvFiles +
    `cd ${shellQuote(dir)} 2>/dev/null || exit 0\n` +
    `keep=" ${safeKeep.join(" ")} "\n` +
    `for d in */; do\n` +
    `  d=\${d%/}\n` +
    `  [ -d "$d" ] || continue\n` +
    `  if [[ "$d" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] && [[ "$keep" != *" $d "* ]]; then\n` +
    `    rm -rf -- "$d"; echo "Removed old release \${d:0:8}"\n` +
    `  fi\n` +
    `done\n` +
    `rm -f ${shellQuote(projectDir(home, slug))}/incoming/*.tar.gz 2>/dev/null || true\n`
  );
}

/** Stop and remove a preview service and its release folder. */
export function removePreview(args: {
  home: string;
  slug: string;
  releaseId: string;
  unit: string;
  unitDir: string;
}) {
  return (
    SH_MARKER_HELPERS +
    removeOwnUnit(args.unitDir, args.unit) +
    `p=${shellQuote(projectDir(args.home, args.slug))}\n` +
    `if egg_dir_managed "$p"; then\n` +
    `  if [[ ${shellQuote(args.releaseId)} =~ ^[0-9a-f-]{36}$ ]]; then rm -rf ${shellQuote(releaseDir(args.home, args.slug, args.releaseId))}; rm -f ${shellQuote(envFileOf(args.home, args.slug, args.releaseId))}; fi\n` +
    `elif [ -e "$p" ] || [ -L "$p" ]; then echo ${shellQuote(`Project folder ${projectDir(args.home, args.slug)} was not created by Egg, so it was left alone.`)} >&2; exit ${NOT_OURS_EXIT}; fi\n`
  );
}

/**
 * Stop, disable and delete a service file, but only when it carries our
 * marker. A service with the same name that someone else wrote is left alone.
 * Needs SH_MARKER_HELPERS earlier in the script.
 */
export function removeOwnUnit(unitDir: string, unit: string) {
  const file = shellQuote(`${unitDir}/${unit}`);
  const failure = 45;
  return (
    `if egg_unit_marked ${file}; then\n` +
    `  systemctl stop ${shellQuote(unit)} >/dev/null 2>&1 || { echo ${shellQuote(`Could not stop ${unit}; it was left in place.`)} >&2; exit ${failure}; }\n` +
    `  if systemctl is-active --quiet ${shellQuote(unit)}; then echo ${shellQuote(`Could not stop ${unit}; it is still active and was left in place.`)} >&2; exit ${failure}; fi\n` +
    `  systemctl disable ${shellQuote(unit)} >/dev/null 2>&1 || { echo ${shellQuote(`Could not disable ${unit}; it was left in place.`)} >&2; exit ${failure}; }\n` +
    `  rm -f -- ${file} || { echo ${shellQuote(`Could not remove ${unit}; its file was left in place.`)} >&2; exit ${failure}; }\n` +
    `  systemctl daemon-reload >/dev/null 2>&1 || { echo ${shellQuote(`Could not reload systemd after removing ${unit}.`)} >&2; exit ${failure}; }\n` +
    `elif [ -e ${file} ] || [ -L ${file} ]; then echo ${shellQuote(`${unit} was not created by Egg, so it was left alone.`)} >&2; exit ${NOT_OURS_EXIT}; fi\n`
  );
}

/** Remove a whole project from the server: service, releases, data. */
export function removeProject(args: {
  home: string;
  slug: string;
  unit: string;
  unitDir: string;
  deleteData: boolean;
}) {
  const p = projectDir(args.home, args.slug);
  // The folder is only touched when Egg made it: a user's own checkout
  // at the same path is never deleted, with or without "delete data".
  const remove = args.deleteData
    ? `rm -rf ${shellQuote(p)}`
    : `rm -rf ${shellQuote(`${p}/releases`)} ${shellQuote(`${p}/incoming`)} ${shellQuote(`${p}/current`)} ${shellQuote(envDir(args.home, args.slug))} ${shellQuote(currentEnvLink(args.home, args.slug))} || exit 45\n${removeManagedDownloadCache(p)}`;
  return (
    SH_MARKER_HELPERS +
    removeOwnUnit(args.unitDir, args.unit) +
    `if egg_dir_managed ${shellQuote(p)}; then\n${remove}\nelif [ -e ${shellQuote(p)} ] || [ -L ${shellQuote(p)} ]; then echo ${shellQuote(`${p} was not created by Egg, so it was left alone.`)} >&2; exit ${NOT_OURS_EXIT}; fi\n`
  );
}

/** Destructive cleanup requires explicit ownership markers and a confirmed stop. */
export function cleanupOwnedProject(args: { home: string; slug: string; units: string[]; unitDir: string }) {
  const folder = projectDir(args.home, args.slug);
  return HEAD + SH_MARKER_HELPERS +
    `d=${shellQuote(folder)}\n` +
    `if [ -e "$d" ] || [ -L "$d" ]; then [ -d "$d" ] && [ ! -L "$d" ] && [ -f "$d/.egg-managed" ] && [ ! -L "$d/.egg-managed" ] || { echo 'Project folder ownership cannot be verified; nothing was deleted.' >&2; exit 44; }; fi\n` +
    args.units.map((unit) => {
      const file = shellQuote(`${args.unitDir}/${unit}`);
      return `if [ -e ${file} ] || [ -L ${file} ]; then egg_unit_marked ${file} || { echo 'Service ownership cannot be verified; nothing was deleted.' >&2; exit 44; }; fi\n`;
    }).join("") +
    args.units.map((unit) => {
      const file = shellQuote(`${args.unitDir}/${unit}`);
      return `if [ -e ${file} ]; then systemctl stop ${shellQuote(unit)} || exit 45; if systemctl is-active --quiet ${shellQuote(unit)}; then echo 'Service is still active; cleanup stopped.' >&2; exit 45; fi; systemctl disable ${shellQuote(unit)} || exit 45; rm -f -- ${file} || exit 45; fi\n`;
    }).join("") +
    `systemctl daemon-reload || exit 45\n` +
    `if [ -d "$d" ]; then rm -rf -- "$d/releases" "$d/incoming" "$d/env"; rm -f -- "$d/current" "$d/current.new" "$d/current.env" "$d/current.env.new";\n${removeManagedDownloadCache(folder)}fi\n` +
    `echo 'EGG_CLEANUP_WARNING: Shared application data was preserved. Remove it manually only after making a backup.'\n`;
}

export function runtimeLogs(unit: string, lines: number, since?: string, until?: number) {
  return journalTail(unit, Math.max(1, Math.min(lines, 1000)), since, until);
}

/**
 * Print the state of a service as EGG_KEY=value lines: what systemd says about
 * it, the machine's uptime, and one real request to the app's health path.
 * Nothing here changes anything, and every step tolerates failure so a stopped
 * or missing service still produces a readable answer.
 */
export function serviceStatus(args: { unit: string; port: number; path: string }) {
  const path = args.path.startsWith("/") ? args.path : `/${args.path}`;
  return (
    `unit=${shellQuote(args.unit)}\nport=${Number(args.port)}\npath=${shellQuote(path)}\n` +
    `echo "EGG_ACTIVE=$(systemctl is-active "$unit" 2>/dev/null || true)"\n` +
    `systemctl show "$unit" -p LoadState -p ActiveState -p SubState -p MainPID -p NRestarts ` +
    `-p MemoryCurrent -p CPUUsageNSec -p ActiveEnterTimestampMonotonic 2>/dev/null | sed 's/^/EGG_/' || true\n` +
    `echo "EGG_UPTIME=$(cut -d' ' -f1 /proc/uptime 2>/dev/null || true)"\n` +
    `if command -v curl >/dev/null 2>&1; then\n` +
    `  echo "EGG_HTTP=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 3 "http://127.0.0.1:$port$path" || true)"\n` +
    `fi\n` +
    `true\n`
  );
}

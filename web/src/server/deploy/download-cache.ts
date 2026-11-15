import { shellQuote } from "@/server/ssh/connection";
export const DOWNLOAD_CACHE_MAX_MB = 256;
export type NpmCachePlan = { context: "production" | "preview" };
/** Remove marked entries only, preserving unknown files in a partly managed cache. */
export function removeManagedDownloadCache(project: string): string {
  return `cache_base=${shellQuote(`${project}/cache`)}
if [ -d "$cache_base" ] && [ ! -L "$cache_base" ] && [ -f "$cache_base/.egg-cache-managed" ] && [ ! -L "$cache_base/.egg-cache-managed" ] && [ -d "$cache_base/npm" ] && [ ! -L "$cache_base/npm" ]; then
  for context in production preview; do
    root="$cache_base/npm/$context"
    [ -d "$root" ] && [ ! -L "$root" ] || continue
    for entry in "$root"/*; do
      [ -d "$entry" ] && [ ! -L "$entry" ] && [ -f "$entry/.egg-cache-entry-managed" ] && [ ! -L "$entry/.egg-cache-entry-managed" ] || continue
      [[ "\${entry##*/}" =~ ^[a-f0-9]{64}$ ]] || continue
      rm -rf -- "$entry" || exit 45
    done
  done
fi
`;
}
/** Only immutable-lockfile npm ci defaults qualify. Custom commands stay clean. */
export function npmCachePlan(a: { enabled: boolean; env: "production" | "preview"; lockHash: string | null; buildInstall: string | null; remoteInstall: string | null }): NpmCachePlan | null {
  if (!a.enabled || !a.lockHash || !/^[a-f0-9]{64}$/.test(a.lockHash)) return null;
  if (a.buildInstall !== "npm ci" || (a.remoteInstall !== null && a.remoteInstall !== "npm ci --omit=dev")) return null;
  return { context: a.env };
}

/** Shell runs only inside the project build scope and the server build lock. */
export function npmCacheScript(root: string, lockHash: string, release: string): string {
  if (!/^[a-f0-9]{64}$/.test(lockHash)) throw new Error("Invalid cache lock hash");
  return [
    `egg_cache_root=${shellQuote(root)}`,
    `egg_cache_parent=\${egg_cache_root%/*}`,
    `egg_cache_base=\${egg_cache_parent%/*}`,
    `egg_cache_project=\${egg_cache_base%/*}`,
    `egg_cache_ok=0`,
    // Do not adopt, follow, or clean a pre-existing unmanaged or linked cache tree.
    `if [ -f "$egg_cache_project/.egg-managed" ] && [ ! -L "$egg_cache_project/.egg-managed" ] && [ ! -L "$egg_cache_base" ] && [ ! -L "$egg_cache_parent" ] && [ ! -L "$egg_cache_root" ]; then`,
    `  if [ ! -e "$egg_cache_base" ]; then if mkdir -m 700 "$egg_cache_base"; then : > "$egg_cache_base/.egg-cache-managed" || true; fi; fi`,
    `  if [ -f "$egg_cache_base/.egg-cache-managed" ] && [ ! -L "$egg_cache_base/.egg-cache-managed" ]; then`,
    `    mkdir -p -m 700 "$egg_cache_root" && egg_cache_ok=1`,
    `  fi`,
    `fi`,
    `egg_npm() {`,
    `  local key store temp entry size`,
    `  if [ "$egg_cache_ok" = 1 ] && command -v sha256sum >/dev/null && command -v du >/dev/null; then`,
    `    key=$(printf '%s\\n' ${shellQuote(lockHash)} "$(node --version 2>/dev/null)" "$(npm --version 2>/dev/null)" "$(uname -m 2>/dev/null)" | sha256sum | cut -d' ' -f1)`,
    `    if [[ "$key" =~ ^[a-f0-9]{64}$ ]]; then`,
    `      for entry in "$egg_cache_root"/*; do`,
    `        [ -d "$entry" ] && [ ! -L "$entry" ] && [ -f "$entry/.egg-cache-entry-managed" ] && [ ! -L "$entry/.egg-cache-entry-managed" ] || continue`,
    `        [[ "\${entry##*/}" =~ ^[a-f0-9]{64}$ ]] || continue`,
    `        if [ "\${entry##*/}" != "$key" ] || [ -n "$(find "$entry" -maxdepth 0 -mtime +14 -print 2>/dev/null)" ]; then rm -rf -- "$entry" || true; fi`,
    `      done`,
    `      store="$egg_cache_root/$key"; temp=${shellQuote(`${release}/.egg-npm-cache`)}`,
    `      if [ ! -e "$store" ] && [ ! -L "$store" ]; then mkdir -m 700 "$store" && : > "$store/.egg-cache-entry-managed" || true; fi`,
    `      if [ -d "$store" ] && [ ! -L "$store" ] && [ -f "$store/.egg-cache-entry-managed" ] && [ ! -L "$store/.egg-cache-entry-managed" ] && [ ! -e "$temp" ] && [ ! -L "$temp" ] && mkdir -m 700 "$temp" && ln -s "$store" "$temp/_cacache"; then`,
    `        size=$(du -sm "$store" 2>/dev/null | cut -f1)`,
    `        if [[ "$size" =~ ^[0-9]+$ ]] && [ "$size" -le ${DOWNLOAD_CACHE_MAX_MB} ]; then`,
    `          if ! npm cache verify --cache "$temp" --logs-max=0 --loglevel=error >/dev/null 2>&1; then if rm -rf -- "$store" && mkdir -m 700 "$store" && : > "$store/.egg-cache-entry-managed"; then :; else egg_cache_ok=0; fi; fi`,
    `          if [ "$egg_cache_ok" = 1 ]; then local code; printf '%s\\n' "$key" > "$temp/.egg-active"; if npm "$@" --cache "$temp" --logs-max=0 --loglevel=error; then code=0; else code=$?; fi; rm -rf -- "$temp" || true; return "$code"; fi`,
    `        fi`,
    `        rm -rf -- "$temp" || true`,
    `      fi`,
    `    fi`,
    `  fi`,
    `  npm "$@" --logs-max=0 --loglevel=error`,
    `}`,
  ].join("\n");
}

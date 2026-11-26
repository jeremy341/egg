import { SH_MARKER_HELPERS, isValidSlug } from "@/server/deploy/layout";
import { PORTS_SNIPPET, parseNetstatLine, parseSsLine } from "@/server/ssh/inventory-probe";
import { shellQuote } from "@/server/ssh/connection";

/**
 * A read-only look at one project's place on a container, before anything is
 * written there: is its service name, folder or port already taken, and is the
 * same repository already running by hand? Like the inventory probe it only
 * reads, and its output is tab-separated lines that parseAdoption turns into a
 * plain object, so the parsing is testable without a container.
 *
 * Never emitted: command lines, environment, file contents or git remote URLs
 * (a remote can carry a token). Only names, pids and home-relative paths.
 */

export type AdoptionProbeArgs = {
  /** Where Egg installs units. */
  unitDir: string;
  slug: string;
  /** The unit this deploy would write, for example egg-blog.service. */
  unit: string;
  port: number;
  /** owner/repo on GitHub, or null when it is not known. */
  repo: string | null;
};

const UNIT_NAME = /^egg-[a-z0-9]+(?:-[a-z0-9]+)*\.service$/;
const REPO = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;

export type AdoptionRaw = {
  home: string;
  /** The unit file at <unitDir>/<unit>, when one exists. */
  unitFile: { managed: boolean; active: string } | null;
  /** The unit as systemd knows it (loaded from somewhere), with its pid and cgroup. */
  own: { pid: number | null; controlGroup: string | null; loaded: boolean };
  /** What is at ~/.egg/<slug>. */
  folder:
    | { kind: "link" | "file" }
    | { kind: "dir"; managed: boolean; git: boolean; entries: number }
    | null;
  ports: { port: number; address: string; process: string | null; pid: number | null; cgroups: string[] }[];
  portsSource: "ss" | "netstat" | "none";
  /** Processes whose working folder is in this project's folder or in a checkout of the repo. */
  processes: { pid: number; comm: string; cwd: string; sameRepo: boolean; inTarget: boolean; cgroups: string[] }[];
  /** Other service files whose WorkingDirectory is in a checkout of the repo or in the project folder. */
  units: { name: string; active: string; cwd: string; sameRepo: boolean; inTarget: boolean }[];
  /** Folders under the home folder that are a git checkout of the repo. */
  checkouts: string[];
};

export class AdoptionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdoptionParseError";
  }
}

export function adoptionScript(args: AdoptionProbeArgs): string {
  if (!isValidSlug(args.slug)) throw new Error("Invalid project name");
  if (!UNIT_NAME.test(args.unit)) throw new Error("Invalid service name");
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) throw new Error("Invalid port");
  if (args.repo !== null && !REPO.test(args.repo)) throw new Error("Invalid repository name");

  return `
set +e
unit_dir=${shellQuote(args.unitDir)}
slug=${shellQuote(args.slug)}
unit=${shellQuote(args.unit)}
repo=${shellQuote(args.repo ?? "")}
base="$HOME/.egg"
dir="$base/$slug"
repo_l=$(printf '%s' "$repo" | tr 'A-Z' 'a-z')
${SH_MARKER_HELPERS}
# Does the git checkout at $1 have a remote that is this repository? Only a yes or no leaves here.
git_match() {
  [ -n "$repo_l" ] || return 1
  local cfg u; cfg="$1/.git/config"; [ -f "$cfg" ] || return 1
  while IFS= read -r u; do
    u=$(printf '%s' "\${u#*=}" | tr 'A-Z' 'a-z' | tr -d ' \\t\\r'); u=\${u%.git}
    case "$u" in *github.com/"$repo_l"|*github.com:"$repo_l") return 0;; esac
  done < <(grep -i '^[[:space:]]*url[[:space:]]*=' "$cfg" 2>/dev/null)
  return 1
}
# The nearest folder with a .git, from $1 up to (not including) the home folder.
git_root() {
  local d; d="$1"
  while [ -n "$d" ] && [ "$d" != "$HOME" ] && [ "$d" != "/" ]; do
    [ -d "$d/.git" ] && { printf '%s' "$d"; return 0; }
    d=$(dirname "$d")
  done
  return 1
}
rel() { printf '%s' "\${1#$HOME/}" | tr '\\t\\n\\r' '   '; }

echo "home=$HOME"

# The service file, and what systemd says about the name.
f="$unit_dir/$unit"
if [ -e "$f" ] || [ -L "$f" ]; then
  m=0; if egg_unit_marked "$f"; then m=1; fi
  printf 'UNITFILE\\t%s\\t%s\\n' "$m" "$(systemctl is-active "$unit" 2>/dev/null)"
fi
load=""; pid=""; cg=""
while IFS='=' read -r k v; do
  case "$k" in LoadState) load=$v;; MainPID) pid=$v;; ControlGroup) cg=$v;; esac
done < <(systemctl show "$unit" -p LoadState -p MainPID -p ControlGroup 2>/dev/null)
printf 'OWN\\t%s\\t%s\\t%s\\n' "$load" "$pid" "$cg"

# The project folder.
if [ -L "$dir" ]; then printf 'FOLDER\\tlink\\n'
elif [ -d "$dir" ]; then
  mk=0; if egg_dir_managed "$dir"; then mk=1; fi
  gt=0; if [ -e "$dir/.git" ]; then gt=1; fi
  cnt=$(ls -A "$dir" 2>/dev/null | wc -l | tr -d ' ')
  printf 'FOLDER\\tdir\\t%s\\t%s\\t%s\\n' "$mk" "$gt" "$cnt"
elif [ -e "$dir" ]; then printf 'FOLDER\\tfile\\n'
fi

# Listening ports.
${PORTS_SNIPPET}
# Processes working inside this project's folder (not in a release of ours), or inside a checkout of the repo.
skip="^(bash|sh|zsh|fish|dash|ksh|tmux|screen|vim|nvim|vi|nano|less|man|top|htop|git|ssh|sshd|sftp-server|login|su|sudo|tail|cat)$"
for p in /proc/[0-9]*; do
  pid=\${p#/proc/}
  [ "$pid" = "$$" ] && continue
  cwd=$(readlink "$p/cwd" 2>/dev/null)
  case "$cwd" in "$HOME"/*) ;; *) continue;; esac
  case "$cwd/" in "$dir"/releases/*) continue;; esac
  comm=$(tr '\\t\\n\\r' '   ' < "$p/comm" 2>/dev/null)
  if printf '%s' "$comm" | grep -qE "$skip"; then continue; fi
  inside=0; case "$cwd/" in "$dir"/*) inside=1;; esac
  match=0
  case "$cwd/" in "$base"/*) ;; *) root=$(git_root "$cwd") && git_match "$root" && match=1;; esac
  [ "$inside" = 1 ] || [ "$match" = 1 ] || continue
  cgs=$(sed -n 's/^[0-9]*:[^:]*://p' "$p/cgroup" 2>/dev/null | tr '\\n' ',')
  printf 'PROC\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$pid" "$comm" "$(rel "$cwd")" "$match" "$inside" "$cgs"
done | head -50

# Other service files that run from this project's folder or from a checkout of the repo.
for uf in "$unit_dir"/*.service /etc/systemd/system/*.service; do
  [ -f "$uf" ] || continue
  n=$(basename "$uf")
  [ "$n" = "$unit" ] && continue
  if egg_unit_marked "$uf"; then continue; fi
  wd=$(grep -m1 '^WorkingDirectory=' "$uf" 2>/dev/null | cut -d= -f2- | tr -d '\\r\\t')
  wd=\${wd#-}
  case "$wd" in "~"|"~/"*) wd="$HOME\${wd#\\~}";; "%h"*) wd="$HOME\${wd#%h}";; esac
  case "$wd" in "$HOME"/*) ;; *) continue;; esac
  case "$wd/" in "$dir"/releases/*) continue;; esac
  inside=0; case "$wd/" in "$dir"/*) inside=1;; esac
  match=0
  case "$wd/" in "$base"/*) ;; *) root=$(git_root "$wd") && git_match "$root" && match=1;; esac
  [ "$inside" = 1 ] || [ "$match" = 1 ] || continue
  printf 'WUNIT\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$n" "$(systemctl is-active "$n" 2>/dev/null)" "$(rel "$wd")" "$match" "$inside"
done | sort -u | head -50

# Checkouts of the repo anywhere near the top of the home folder.
if [ -n "$repo_l" ]; then
  T=""; if command -v timeout >/dev/null 2>&1; then T="timeout 20"; fi
  $T find "$HOME" -maxdepth 3 -name .git -type d -not -path "$base/*" -not -path '*/node_modules/*' -not -path '*/.cache/*' 2>/dev/null | head -200 | while IFS= read -r g; do
    r=$(dirname "$g")
    if git_match "$r"; then printf 'CHECKOUT\\t%s\\n' "$(rel "$r")"; fi
  done
fi
echo "END=1"
`;
}

function toNumber(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Turn the script's output into a plain object. Throws when the output is cut short. */
export function parseAdoption(output: string): AdoptionRaw {
  const kv = new Map<string, string>();
  const portLines: string[] = [];
  const pidGroups = new Map<number, string[]>();
  const raw: AdoptionRaw = {
    home: "",
    unitFile: null,
    own: { pid: null, controlGroup: null, loaded: false },
    folder: null,
    ports: [],
    portsSource: "none",
    processes: [],
    units: [],
    checkouts: [],
  };

  for (const line of output.split(/\r?\n/)) {
    const f = line.split("\t");
    switch (f[0]) {
      case "UNITFILE":
        raw.unitFile = { managed: f[1] === "1", active: (f[2] ?? "").trim() };
        break;
      case "OWN": {
        const pid = toNumber(f[2]);
        raw.own = {
          loaded: f[1] === "loaded",
          pid: pid && pid > 0 ? pid : null,
          controlGroup: f[3] ? f[3] : null,
        };
        break;
      }
      case "FOLDER":
        if (f[1] === "link" || f[1] === "file") raw.folder = { kind: f[1] };
        else if (f[1] === "dir") {
          raw.folder = { kind: "dir", managed: f[2] === "1", git: f[3] === "1", entries: toNumber(f[4]) ?? 0 };
        }
        break;
      case "PORT":
        portLines.push(line.slice(5));
        break;
      case "PIDCG": {
        const n = toNumber(f[1]);
        if (n !== null) pidGroups.set(n, (f[2] ?? "").split(",").filter(Boolean));
        break;
      }
      case "PROC": {
        const pid = toNumber(f[1]);
        if (pid === null || !f[2]) break;
        raw.processes.push({
          pid,
          comm: f[2].trim(),
          cwd: f[3] ?? "",
          sameRepo: f[4] === "1",
          inTarget: f[5] === "1",
          cgroups: (f[6] ?? "").split(",").filter(Boolean),
        });
        break;
      }
      case "WUNIT":
        if (!f[1]) break;
        raw.units.push({
          name: f[1],
          active: (f[2] ?? "").trim(),
          cwd: f[3] ?? "",
          sameRepo: f[4] === "1",
          inTarget: f[5] === "1",
        });
        break;
      case "CHECKOUT":
        if (f[1]) raw.checkouts.push(f[1]);
        break;
      default: {
        const i = line.indexOf("=");
        if (i > 0 && !line.includes("\t")) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
      }
    }
  }

  if (kv.get("END") !== "1" || !kv.get("home")) {
    throw new AdoptionParseError("The container's answer was cut short, so nothing was checked.");
  }
  raw.home = kv.get("home")!;

  const source = kv.get("ports_format");
  raw.portsSource = source === "ss" || source === "netstat" ? source : "none";
  const parse = raw.portsSource === "netstat" ? parseNetstatLine : parseSsLine;
  for (const line of portLines) {
    const p = parse(line);
    if (!p) continue;
    raw.ports.push({
      port: p.port,
      address: p.address,
      process: p.process,
      pid: p.pid,
      cgroups: p.pid !== null ? (pidGroups.get(p.pid) ?? []) : [],
    });
  }
  return raw;
}

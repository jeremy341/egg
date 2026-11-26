import { shellQuote, type NestSession } from "@/server/ssh/connection";
import type { ProjectFiles, RuntimeInput, RuntimeSpec } from "@/server/deploy/runtime";

/**
 * What a build on the Nest container needs, checked before anything is uploaded. The
 * facts come from one read-only script; the decisions are pure functions so each rule
 * can be tested without a container.
 */

/** The Node.js version a project needs when its package.json does not say. */
export const MIN_NODE_VERSION = "22.13";
/** Free disk space needed in the release area before a build starts, in MB. */
export const MIN_FREE_DISK_MB = 2048;

export type PreflightFacts = {
  /** False when the script printed nothing we recognise. */
  ran: boolean;
  nodeVersion: string | null;
  hasNpm: boolean;
  hasCorepack: boolean;
  hasPython3: boolean;
  /** `python3 -m venv --help` works. */
  pythonVenv: boolean;
  hasSystemdRun: boolean;
  hasTimeout: boolean;
  /** cgroup v2 with the memory controller, which a memory cap needs. */
  cgroupMemory: boolean;
  /** A trial scope with a memory cap could be created. */
  scopeOk: boolean;
  diskFreeMb: number | null;
  memTotalMb: number | null;
};

export function preflightScript(releasesDir: string): string {
  const inner = [
    `has() { command -v "$1" >/dev/null 2>&1 && echo 1 || echo 0; }`,
    `echo EGG_PREFLIGHT=1`,
    `echo "node_version=$(node -v 2>/dev/null)"`,
    `echo "has_npm=$(has npm)"`,
    `echo "has_corepack=$(has corepack)"`,
    `echo "has_python3=$(has python3)"`,
    `if python3 -m venv --help >/dev/null 2>&1; then echo python_venv=1; else echo python_venv=0; fi`,
    `echo "has_systemd_run=$(has systemd-run)"`,
    `echo "has_timeout=$(has timeout)"`,
    `if [ -f /sys/fs/cgroup/cgroup.controllers ] && grep -qw memory /sys/fs/cgroup/cgroup.controllers; then echo cgroup_memory=1; else echo cgroup_memory=0; fi`,
    // A container without a running systemd can make systemd-run wait for a bus: give the trial ten seconds.
    `t=""; command -v timeout >/dev/null 2>&1 && t="timeout 10"`,
    `if $t systemd-run --scope --quiet --collect --property=MemoryMax=64M -- true >/dev/null 2>&1; then echo scope_ok=1; else echo scope_ok=0; fi`,
    `d=${shellQuote(releasesDir)}; while [ ! -e "$d" ] && [ "$d" != / ]; do d=$(dirname "$d"); done`,
    `echo "disk_free_mb=$(df -Pm "$d" 2>/dev/null | awk 'NR==2 {print $4}')"`,
    `awk '/^MemTotal:/ {printf "mem_total_mb=%d\\n", $2/1024}' /proc/meminfo 2>/dev/null`,
    `true`,
  ].join("\n");
  // A login shell, because that is what the build and the service use to find node.
  return `set +e\nbash -lc ${shellQuote(inner)}\n`;
}

export function parsePreflight(output: string): PreflightFacts {
  const kv = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  const flag = (k: string) => kv.get(k) === "1";
  const num = (k: string) => {
    const v = kv.get(k);
    if (v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    ran: kv.get("EGG_PREFLIGHT") === "1",
    nodeVersion: kv.get("node_version") || null,
    hasNpm: flag("has_npm"),
    hasCorepack: flag("has_corepack"),
    hasPython3: flag("has_python3"),
    pythonVenv: flag("python_venv"),
    hasSystemdRun: flag("has_systemd_run"),
    hasTimeout: flag("has_timeout"),
    cgroupMemory: flag("cgroup_memory"),
    scopeOk: flag("scope_ok"),
    diskFreeMb: num("disk_free_mb"),
    memTotalMb: num("mem_total_mb"),
  };
}

export type PreflightRunner = (releasesDir: string, signal?: AbortSignal) => Promise<PreflightFacts>;

export function sessionPreflight(session: Pick<NestSession, "script">): PreflightRunner {
  return async (releasesDir, signal) => {
    const res = await session.script(preflightScript(releasesDir), { timeoutMs: 60_000, signal });
    return parsePreflight(res.stdout);
  };
}

// ----------------------------------------------------------------- node versions

type Ver = [number, number, number];
type Bound = [op: ">=" | ">" | "<" | "<=", v: Ver];

const cmpVer = (a: Ver, b: Ver) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** A `v22.13.1` style version, or null. */
export function parseNodeVersion(text: string | null | undefined): Ver | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec((text ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function parsePartial(s: string): { v: Ver; parts: number } | "any" | null {
  const t = s.trim().replace(/^v/i, "");
  if (t === "" || /^[xX*]$/.test(t)) return "any";
  const m = /^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-+][0-9A-Za-z.-]+)?$/.exec(t);
  if (!m) return null;
  const nums: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const g = m[i];
    if (g === undefined || /^[xX*]$/.test(g)) break;
    nums.push(Number(g));
  }
  if (nums.length === 0) return "any";
  const parts = nums.length;
  while (nums.length < 3) nums.push(0);
  return { v: nums as Ver, parts };
}

/** The first version above everything a partial version such as `22` or `22.13` covers. */
function bump(v: Ver, parts: number): Ver {
  if (parts === 1) return [v[0] + 1, 0, 0];
  if (parts === 2) return [v[0], v[1] + 1, 0];
  return [v[0], v[1], v[2] + 1];
}

function comparator(token: string): Bound[] | null {
  const m = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(token);
  if (!m) return null;
  const op = m[1] ?? "=";
  const p = parsePartial(m[2]);
  if (p === null) return null;
  if (p === "any") return [];
  const { v, parts } = p;
  switch (op) {
    case "=":
      return [[">=", v], ["<", bump(v, parts)]];
    case ">=":
      return [[">=", v]];
    case ">":
      return parts === 3 ? [[">", v]] : [[">=", bump(v, parts)]];
    case "<":
      return [["<", v]];
    case "<=":
      return parts === 3 ? [["<=", v]] : [["<", bump(v, parts)]];
    case "~":
      return [[">=", v], ["<", parts === 1 ? [v[0] + 1, 0, 0] : [v[0], v[1] + 1, 0]]];
    default: {
      // caret
      const upper: Ver =
        v[0] > 0 ? [v[0] + 1, 0, 0] : parts === 1 ? [1, 0, 0] : v[1] > 0 || parts === 2 ? [0, v[1] + 1, 0] : [0, 0, v[2] + 1];
      return [[">=", v], ["<", upper]];
    }
  }
}

function holds(version: Ver, [op, v]: Bound) {
  const c = cmpVer(version, v);
  return op === ">=" ? c >= 0 : op === ">" ? c > 0 : op === "<" ? c < 0 : c <= 0;
}

/**
 * Whether `version` is inside an npm style `engines.node` range. Handles `>=`, `^`, `~`,
 * partial versions, hyphen ranges and `||`. Returns null for a range it cannot read.
 */
export function satisfiesNodeRange(versionText: string, range: string): boolean | null {
  const version = parseNodeVersion(versionText);
  if (!version) return null;
  const normal = range
    .trim()
    .replace(/(\S+)\s+-\s+(\S+)/g, ">=$1 <=$2")
    .replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1");
  for (const set of normal.split("||")) {
    const tokens = set.trim().split(/\s+/).filter(Boolean);
    let all = true;
    for (const token of tokens) {
      const bounds = comparator(token);
      if (bounds === null) return null;
      if (!bounds.every((b) => holds(version, b))) all = false;
    }
    if (all) return true;
  }
  return false;
}

// ----------------------------------------------------------------- what a project needs

export type PreflightNeeds = {
  /** Node.js is used to install or build. */
  node: boolean;
  nodeEngine: string | null;
  /** The package manager the lockfile needs, when the default install command is used. */
  packageManager: "npm" | "pnpm" | "yarn" | null;
  /** The project installs Python requirements. */
  python: boolean;
  /** Something has to run on the container (install or build), so it needs the cap. */
  buildWork: boolean;
};

export function preflightNeeds(
  input: Pick<RuntimeInput, "runtime" | "installCommand">,
  files: ProjectFiles,
  spec: Pick<RuntimeSpec, "buildInstall" | "buildCommand" | "remoteInstall">
): PreflightNeeds {
  const buildWork = Boolean(spec.buildInstall || spec.buildCommand || spec.remoteInstall);
  const node = (input.runtime === "node" || input.runtime === "static") && files.hasPackageJson && buildWork;
  return {
    node,
    nodeEngine: files.nodeEngine ?? null,
    packageManager: node && !input.installCommand ? (files.lockfile ?? "npm") : null,
    python: input.runtime === "python" && files.hasRequirements,
    buildWork,
  };
}

// ----------------------------------------------------------------- decisions

export type PreflightProblem = {
  check: "probe" | "node" | "package-manager" | "python" | "venv" | "disk" | "systemd-run" | "cgroup" | "timeout";
  /** One line telling the owner what to do. */
  fix: string;
};

/** Everything the facts show to be missing, most important first. Empty means go ahead. */
export function evaluatePreflight(facts: PreflightFacts, needs: PreflightNeeds): PreflightProblem[] {
  const out: PreflightProblem[] = [];
  if (!facts.ran) {
    return [
      {
        check: "probe",
        fix: "Egg could not check your container before building, so nothing was uploaded. Check that the container is running and try again.",
      },
    ];
  }

  if (facts.diskFreeMb !== null && facts.diskFreeMb < MIN_FREE_DISK_MB) {
    out.push({
      check: "disk",
      fix: `Free up disk space on your container: ${facts.diskFreeMb} MB is free and a build needs at least ${MIN_FREE_DISK_MB} MB.`,
    });
  }

  if (needs.buildWork) {
    if (!facts.hasSystemdRun) {
      out.push({
        check: "systemd-run",
        fix: "Builds on your container run under a memory cap with systemd-run, which is not installed here, so the build did not start. Install systemd on your container.",
      });
    } else if (!facts.cgroupMemory || !facts.scopeOk) {
      out.push({
        check: "cgroup",
        fix: "Your container cannot apply a memory cap to a build (it needs systemd with cgroup v2 and the memory controller), so the build did not start rather than run without a limit. Builds never run without the cap.",
      });
    }
    if (!facts.hasTimeout) {
      out.push({
        check: "timeout",
        fix: "Install coreutils on your container: sudo apt install coreutils (the build needs the timeout command).",
      });
    }
  }

  if (needs.node) {
    if (!facts.nodeVersion) {
      out.push({
        check: "node",
        fix: needs.nodeEngine
          ? `Install Node.js on your container (this project needs ${needs.nodeEngine}), then deploy again.`
          : `Install Node.js ${MIN_NODE_VERSION} or newer on your container (nodejs.org), then deploy again.`,
      });
    } else {
      // The project's own range decides. With no range, or one we cannot read, the minimum applies.
      const byEngine = needs.nodeEngine ? satisfiesNodeRange(facts.nodeVersion, needs.nodeEngine) : null;
      const ok = byEngine ?? satisfiesNodeRange(facts.nodeVersion, `>=${MIN_NODE_VERSION}`);
      if (ok === false) {
        const wanted = byEngine !== null ? needs.nodeEngine : `>=${MIN_NODE_VERSION}`;
        out.push({
          check: "node",
          fix: `Node.js ${facts.nodeVersion.replace(/^v/, "")} on your container does not match what this project needs (${wanted}). Install a matching Node.js on your container (nodejs.org), then deploy again.`,
        });
      }
    }
    if (needs.packageManager === "npm" && !facts.hasNpm) {
      out.push({
        check: "package-manager",
        fix: "Install npm on your container: sudo apt install npm (installing Node.js from nodejs.org includes it).",
      });
    }
    if ((needs.packageManager === "pnpm" || needs.packageManager === "yarn") && !facts.hasCorepack) {
      out.push({
        check: "package-manager",
        fix: `This project uses ${needs.packageManager}, which needs corepack. On your container run: npm install -g corepack`,
      });
    }
  }

  if (needs.python) {
    if (!facts.hasPython3) {
      out.push({ check: "python", fix: "Install Python 3 on your container: sudo apt install python3" });
    } else if (!facts.pythonVenv) {
      out.push({ check: "venv", fix: "Install python3-venv on your container: sudo apt install python3-venv" });
    }
  }
  return out;
}

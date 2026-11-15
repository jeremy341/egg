import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";
import { createHash } from "node:crypto";
import { statSync, readFileSync } from "node:fs";
import type { Builder, BuildRequest } from "@/server/deploy/build";
import { detectFiles } from "@/server/deploy/build";
import { resolveRuntime } from "@/server/deploy/runtime";
import type { PreflightFacts } from "@/server/deploy/container-probe";
import type { MockSsh } from "@/server/test/mock-ssh";

/** A port nothing is listening on right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

/**
 * Teach the mock container to behave like systemd for the few verbs the
 * pipeline uses. `restart` starts the unit's ExecStart in the background and
 * records a pid, so the health check really talks to a running process.
 */
export function installFakeSystemd(mock: MockSsh) {
  const dir = path.join(process.cwd(), "src/server/test/shims");
  mock.addShim("systemctl", readFileSync(path.join(dir, "systemctl.sh"), "utf8"));
  mock.addShim("journalctl", readFileSync(path.join(dir, "journalctl.sh"), "utf8"));
  mock.writeFile(`${mock.home}/units/.keep`, "");
}

/**
 * Stand-ins for systemd-run and timeout on the mock container. They run the command and record
 * the arguments: a test machine has no memory controller to cap, so what a test can show is the
 * order of events and the arguments, not the kernel enforcing the cap.
 */
const FAKE_SYSTEMD_RUN = `
log="$HOME/.systemd-run.log"
unit=""
args=()
while [ $# -gt 0 ]; do
  case "$1" in --unit=*) unit="\${1#--unit=}";; esac
  if [ "$1" = "--" ]; then shift; break; fi
  args+=("$1"); shift
done
echo "\${args[*]}" >> "$log"
mkdir -p "$HOME/.fake-systemd"
echo $$ > "$HOME/.fake-systemd/$unit.scope.pid"
exec "$@"
`;

const FAKE_TIMEOUT = `
while [ $# -gt 0 ]; do case "$1" in -s|-k) shift 2;; -*) shift;; *) break;; esac; done
shift
exec "$@"
`;

/**
 * Stand-ins for `df` and `du`, so a test can say how much disk the container has. They read the
 * files in `$HOME/.fake-disk`: `free-mb` is the free space `df` reports, `used-mb` the size `du`
 * reports, `df-missing` makes `df` fail like a command that is not installed, and `real` passes
 * both through to the real tools. With none of these, the container has plenty of room.
 */
const FAKE_DF = `
d="$HOME/.fake-disk"
if [ -f "$d/df-missing" ]; then echo "df: command not found" >&2; exit 127; fi
if [ -f "$d/real" ]; then command -p df "$@"; exit $?; fi
free=50000; [ -f "$d/free-mb" ] && free=$(cat "$d/free-mb")
# free-mb is in megabytes; df -Pk asks for kilobytes.
case " $* " in *" -Pk "*) free=$((free * 1024));; esac
echo "Filesystem     1048576-blocks  Used Available Capacity Mounted on"
echo "fake                    99999     1 $free     1% /"
`;

const FAKE_DU = `
d="$HOME/.fake-disk"
if [ -f "$d/real" ]; then command -p du "$@"; exit $?; fi
used=1; [ -f "$d/used-mb" ] && used=$(cat "$d/used-mb")
for last; do :; done
printf '%s\\t%s\\n' "$used" "$last"
`;

/** Make the mock container able to run a build under a cap, the way a deploy needs it. */
export function installFakeContainerBuild(mock: MockSsh) {
  mock.addShim("systemd-run", FAKE_SYSTEMD_RUN);
  mock.addShim("timeout", FAKE_TIMEOUT);
  mock.addShim("df", FAKE_DF);
  mock.addShim("du", FAKE_DU);
}

/** What the check on the container reports when everything a build needs is there. */
export const containerReadyFacts: PreflightFacts = {
  ran: true,
  nodeVersion: "v22.14.0",
  hasNpm: true,
  hasCorepack: true,
  hasPython3: true,
  pythonVenv: true,
  hasSystemdRun: true,
  hasTimeout: true,
  cgroupMemory: true,
  scopeOk: true,
  diskFreeMb: 50_000,
  memTotalMb: 4096,
};

export type FixtureFiles = Record<string, string>;

/** A tiny app: answers GET / with the value of GREETING and its version. */
export function nodeApp(version: string, extra: FixtureFiles = {}): FixtureFiles {
  return {
    "server.js": `
const http = require('http');
http.createServer((req, res) => {
  res.end('${version}:' + (process.env.GREETING || 'none'));
}).listen(Number(process.env.PORT), '0.0.0.0');
`,
    ...extra,
  };
}

/** An app that starts and then dies, so the health check must fail. */
export function brokenApp(): FixtureFiles {
  return { "server.js": "process.exit(1);\n" };
}

/**
 * A source builder that packs a prepared set of files instead of cloning. It never
 * installs or builds, like the real one: the build runs later on the mock container.
 * Everything after it is the real pipeline.
 */
export function fakeBuilder(
  files: () => FixtureFiles,
  hooks: { onBuild?: (req: BuildRequest) => void } = {}
): Builder {
  return async (req) => {
    hooks.onBuild?.(req);
    const work = mkdtempSync(path.join(tmpdir(), "egg-build-"));
    const src = path.join(work, "src");
    mkdirSync(src, { recursive: true });
    for (const [name, content] of Object.entries(files())) {
      const full = path.join(src, name);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    const found = detectFiles(src);
    const spec = resolveRuntime(req.runtime, found);
    const archivePath = path.join(work, "release.tar.gz");
    await tar.create({ gzip: true, file: archivePath, cwd: src, portable: true }, ["."]);
    const sha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
    // Echo a line containing every env value, to prove log masking works.
    req.log("info", `build env: ${Object.values(req.env).join(",")}`);
    return {
      archivePath,
      sha256,
      sizeBytes: statSync(archivePath).size,
      commit: { sha: "a".repeat(40), message: "test commit", author: "tester" },
      spec,
      files: found,
      workDir: work,
    };
  };
}

export function removeDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows may still hold files from a stopped process */
  }
}

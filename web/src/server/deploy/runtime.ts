import type { Runtime } from "@/server/db/schema";
import type { NestProbe } from "@/server/ssh/probe";
import { shellQuote } from "@/server/ssh/connection";

export type ProjectFiles = {
  /** Package manager implied by the lockfile in the project root. */
  lockfile: "npm" | "pnpm" | "yarn" | "bun" | null;
  hasPackageJson: boolean;
  hasBuildScript: boolean;
  hasRequirements: boolean;
  hasPyproject?: boolean;
  hasGemfile?: boolean;
  hasComposer?: boolean;
  hasCargoLock?: boolean;
  hasMaven?: boolean;
  hasGradle?: boolean;
  /** The `engines.node` range in package.json, if there is one. */
  nodeEngine?: string | null;
};

export type RuntimeInput = {
  runtime: Runtime;
  installCommand: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  outputDir: string | null;
};

export type RuntimeSpec = {
  /** Run in the build sandbox, with dev dependencies. */
  buildInstall: string | null;
  buildCommand: string | null;
  /** Run on the Nest container after unpacking. */
  remoteInstall: string | null;
  /** Folder to archive, relative to the project root. */
  archiveRoot: string;
  /** Leave node_modules out of the archive (installed on Nest instead). */
  excludeNodeModules: boolean;
};

/** Choose the committed lockfile, respecting package.json when multiple managers are present. */
export function selectLockfile(has: (name: string) => boolean, field: unknown): ProjectFiles["lockfile"] {
  const candidates = [
    ["bun", has("bun.lock") || has("bun.lockb")], ["pnpm", has("pnpm-lock.yaml")],
    ["yarn", has("yarn.lock")], ["npm", has("package-lock.json")],
  ] as const;
  const chosen = typeof field === "string" ? field.split("@")[0] : null;
  return candidates.find(([name, present]) => present && name === chosen)?.[0]
    ?? candidates.find(([, present]) => present)?.[0] ?? null;
}

const INSTALL = {
  npm: { build: "npm ci", prod: "npm ci --omit=dev" },
  pnpm: {
    build: "corepack enable && pnpm install --frozen-lockfile",
    prod: "corepack enable && pnpm install --prod --frozen-lockfile",
  },
  yarn: {
    build: "corepack enable && yarn install --frozen-lockfile",
    prod: "corepack enable && yarn install --production --frozen-lockfile",
  },
  bun: { build: "bun install --frozen-lockfile", prod: "bun install --production --frozen-lockfile" },
} as const;

const RUN = { npm: "npm run build", pnpm: "pnpm build", yarn: "yarn build", bun: "bun run build" } as const;

export function resolveRuntime(input: RuntimeInput, files: ProjectFiles): RuntimeSpec {
  switch (input.runtime) {
    case "node": {
      const pm = files.lockfile ?? "npm";
      const buildInstall =
        input.installCommand ??
        (files.hasPackageJson
          ? files.lockfile
            ? INSTALL[pm].build
            : "npm install"
          : null);
      const build = input.buildCommand ?? (files.hasBuildScript ? RUN[pm] : null);
      const remoteInstall = files.hasPackageJson
        ? files.lockfile
          ? INSTALL[pm].prod
          : "npm install --omit=dev"
        : null;
      return {
        buildInstall,
        buildCommand: build,
        remoteInstall,
        archiveRoot: ".",
        excludeNodeModules: true,
      };
    }
    case "python":
      return {
        buildInstall: input.installCommand,
        buildCommand: input.buildCommand,
        remoteInstall: files.hasRequirements || files.hasPyproject
          ? `python3 -m venv .venv && .venv/bin/pip install --disable-pip-version-check ${files.hasRequirements ? "-r requirements.txt" : "."}`
          : null,
        archiveRoot: ".",
        excludeNodeModules: false,
      };
    case "static":
      return {
        buildInstall:
          input.installCommand ??
          (files.hasPackageJson
            ? files.lockfile
              ? INSTALL[files.lockfile].build
              : "npm install"
            : null),
        buildCommand:
          input.buildCommand ??
          (files.hasPackageJson && files.hasBuildScript
            ? RUN[files.lockfile ?? "npm"]
            : null),
        remoteInstall: null,
        archiveRoot: input.outputDir?.trim() || ".",
        excludeNodeModules: true,
      };
    case "go":
    case "rust":
    case "ruby":
    case "php":
    case "java":
    case "command":
      return {
        buildInstall: input.installCommand,
        buildCommand: input.buildCommand ?? (input.runtime === "go" ? "go build -o .egg-app ." : input.runtime === "rust" ? `cargo build --release${files.hasCargoLock ? " --locked" : ""}` : input.runtime === "java" && files.hasMaven ? "mvn -B package -DskipTests" : input.runtime === "java" && files.hasGradle ? "gradle build -x test" : null),
        remoteInstall: input.runtime === "ruby" && files.hasGemfile ? "bundle config set --local path vendor/bundle && bundle install" : input.runtime === "php" && files.hasComposer ? "composer install --no-dev --no-interaction" : null,
        archiveRoot: ".",
        excludeNodeModules: false,
      };
  }
}

export class StartCommandError extends Error {}

/**
 * The command systemd runs. Always executed from the release folder with
 * PORT and HOST=0.0.0.0 set, because Nest's proxy reaches the container over
 * its network interface, not over localhost.
 */
export function resolveStartCommand(
  input: Pick<RuntimeInput, "runtime" | "startCommand">,
  probe: Pick<NestProbe, "has"> | null,
  port: number
): string {
  const given = input.startCommand?.trim();
  if (given) return given;

  switch (input.runtime) {
    case "node":
      return "npm start";
    case "python":
      return "python3 app.py";
    case "go":
      return "./.egg-app";
    case "static": {
      if (!probe || probe.has.python3) {
        return `python3 -c ${shellQuote(STATIC_PYTHON_SCRIPT)} ${port}`;
      }
      if (probe.has.node) {
        // A dependency-free static file server.
        return `node -e ${shellQuote(STATIC_NODE_SCRIPT)}`;
      }
      throw new StartCommandError(
        "Static sites need Python 3 or Node.js on your Nest container to be served."
      );
    }
    case "rust":
    case "ruby":
    case "php":
    case "java":
    case "command":
      throw new StartCommandError(
        "Set a start command for this project (for example ./my-binary)."
      );
  }
}

/**
 * The static servers below are what Egg runs for a static site. Both refuse the same things, on
 * top of the rule that no variables file is ever inside the release folder (see layout.ts):
 *  - a malformed address (a bad percent escape, a NUL byte or a backslash): 400, and the process
 *    keeps running;
 *  - any path segment that starts with a dot (.env, .git, .htaccess, and ".." itself): 404;
 *  - a path whose real location, after following every link, is outside the folder or has a
 *    segment that starts with a dot: 404. A link inside the site cannot point out of it.
 * Only GET and HEAD are answered. A folder is answered with its index.html, never a listing.
 * Neither script uses a backslash or a dollar sign, so it passes through the shell and the
 * systemd unit unchanged.
 */
export const STATIC_NODE_SCRIPT = `
const http=require('http'),fs=require('fs'),path=require('path');
const root=fs.realpathSync(process.cwd()),port=+process.env.PORT||3000;
const types={'.html':'text/html','.htm':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon','.txt':'text/plain','.xml':'application/xml','.woff2':'font/woff2','.wasm':'application/wasm'};
const BS=String.fromCharCode(92),NUL=String.fromCharCode(0);
const hidden=(rel)=>rel.split(path.sep).some((s)=>s&&s!=='.'&&s.charAt(0)==='.');
function end(r,code,text,head){try{r.writeHead(code,{'content-type':'text/plain'});r.end(head?undefined:text)}catch(e){}}
function inside(real){const rel=path.relative(root,real);return rel===''||(!path.isAbsolute(rel)&&!hidden(rel))}
function resolve(f,cb,depth=0){fs.realpath(f,(e,real)=>{if(e||!inside(real))return cb(null);fs.stat(real,(e2,st)=>{if(e2)return cb(null);if(!st.isDirectory())return cb(real);if(depth>=1)return cb(null);resolve(path.join(real,'index.html'),cb,depth+1)})})}
const srv=http.createServer((q,r)=>{try{
if(q.method!=='GET'&&q.method!=='HEAD'){r.setHeader('allow','GET, HEAD');return end(r,405,'Method not allowed')}
const head=q.method==='HEAD';
let p;try{p=decodeURIComponent(String(q.url||'/').split('?')[0].split('#')[0])}catch(e){return end(r,400,'Bad request',head)}
if(p.indexOf(NUL)>=0||p.indexOf(BS)>=0)return end(r,400,'Bad request',head);
const segs=p.split('/').filter((s)=>s&&s!=='.');
if(segs.some((s)=>s.charAt(0)==='.'))return end(r,404,'Not found',head);
resolve(path.join(root,...segs),(real)=>{
if(!real)return end(r,404,'Not found',head);
fs.readFile(real,(e,d)=>{if(e)return end(r,404,'Not found',head);try{r.writeHead(200,{'content-type':types[path.extname(real).toLowerCase()]||'application/octet-stream'});r.end(head?undefined:d)}catch(e2){}})})
}catch(e){end(r,500,'Server error')}});
srv.on('error',(e)=>{console.error(String(e&&e.message||e));process.exit(1)});
srv.on('clientError',(e,sock)=>{try{sock.end('HTTP/1.1 400 Bad Request'+String.fromCharCode(13,10,13,10))}catch(e2){}});
srv.listen(port,'0.0.0.0');
process.on('uncaughtException',(e)=>{console.error(String(e&&e.stack||e))});
`.trim();

export const STATIC_PYTHON_SCRIPT = `
import http.server, os, sys
from urllib.parse import quote, unquote, urlsplit
ROOT = os.path.realpath(os.getcwd())
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT') or 3000)
BS = chr(92)
NUL = chr(0)
PCT = chr(37)
HEX = '0123456789abcdefABCDEF'
def malformed(raw):
    i = raw.find(PCT)
    while i != -1:
        if len(raw) < i + 3 or raw[i + 1] not in HEX or raw[i + 2] not in HEX:
            return True
        i = raw.find(PCT, i + 1)
    return False
def hidden(rel):
    return any(s.startswith('.') for s in rel.split(os.sep) if s not in ('', os.curdir))
def inside(path):
    return not hidden(os.path.relpath(os.path.realpath(path), ROOT))
class Handler(http.server.SimpleHTTPRequestHandler):
    def list_directory(self, path):
        self.send_error(404, 'Not found')
        return None
    def send_head(self):
        try:
            raw = urlsplit(self.path).path
            if malformed(raw):
                raise ValueError('bad escape')
            p = unquote(raw, errors='strict')
        except Exception:
            self.send_error(400, 'Bad request')
            return None
        if NUL in p or BS in p:
            self.send_error(400, 'Bad request')
            return None
        parts = [s for s in p.split('/') if s not in ('', '.')]
        if any(s.startswith('.') for s in parts):
            self.send_error(404, 'Not found')
            return None
        full = os.path.join(ROOT, *parts)
        if not inside(full):
            self.send_error(404, 'Not found')
            return None
        if os.path.isdir(full) and p.endswith('/'):
            for name in ('index.html', 'index.htm'):
                candidate = os.path.join(full, name)
                if os.path.exists(candidate) and not inside(candidate):
                    self.send_error(404, 'Not found')
                    return None
        # The base class decides trailing slashes (and redirects) from the raw
        # path, where an encoded slash (/d%2f) is not one: hand it the path the
        # checks above settled on, so a folder's index is served, never a redirect loop.
        self.path = '/' + '/'.join(quote(s, safe='') for s in parts)
        if p.endswith('/') and self.path != '/':
            self.path += '/'
        return super().send_head()
http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
`.trim();

export const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Variables Egg generates outside the encrypted env file and must keep authoritative. */
export const RESERVED_ENV = new Set(["PORT", "HOST", "PATH", "HOME", "NODE_ENV", "EGG"]);

/**
 * systemd EnvironmentFile syntax: KEY="value" with C-style escapes. An empty
 * value is left out: KEY="" would set the variable to an empty string and mask
 * a default the app expects when it is unset.
 */
export function renderEnvFile(vars: Record<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(vars)) {
    if (!ENV_KEY.test(k)) throw new Error(`Invalid environment variable name: ${k}`);
    if (v === "") continue;
    const escaped = v
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r\n|[\r\n]/g, "\\n");
    lines.push(`${k}="${escaped}"`);
  }
  return lines.join("\n") + "\n";
}

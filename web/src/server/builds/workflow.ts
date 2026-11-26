import type { Runtime } from "@/server/db/schema";
import { MAX_ARCHIVE_BYTES } from "@/server/deploy/build";
import { cleanRootDir } from "@/server/root-detect";

/**
 * The GitHub Actions workflow for a project that builds on GitHub. It is made from the project's saved
 * settings and from the contract of the two public build routes (`POST /api/builds/upload` and
 * `GET /api/builds/env`, see `server/builds/uploads.ts` and `app/api/builds/*`):
 *
 * - it runs on every push, because Egg makes a deployment for a push to any branch (the production branch
 *   deploys to production, others build a preview), and by hand with `workflow_dispatch`;
 * - it has two jobs. `build-production` runs only on the production branch and declares
 *   `environment: egg-production`, so the production credentials live in that GitHub Environment, where GitHub
 *   can limit them to the production branch (deployment branch rules) and ask for a reviewer. `build-preview`
 *   runs on every other branch and reads only the preview credentials, kept as repository secrets. A workflow
 *   that someone edits on another branch can ask for the environment, but GitHub then refuses it the secrets;
 * - the build credentials travel only in the Authorization header;
 * - the upload sends the four headers the route requires: X-Egg-Commit, X-Egg-Sha256, X-Egg-Branch, X-Egg-Run;
 * - the archive is the release: the folder the app runs from, with the same layout the container build packs
 *   (`archiveRoot` of `resolveRuntime`): node_modules is left out for Node, because the container does the
 *   production install; a static site sends only its output directory.
 *
 * No secret value is ever written into the file. Project text that reaches the file is either checked against
 * a strict pattern (branch, folders, URL) or is a one-line command that goes into a block scalar.
 */

/** Where the file goes in the repository. */
export const WORKFLOW_PATH = ".github/workflows/egg.yml";

/** The GitHub Environment that holds the production secrets. The production job names it. */
export const PRODUCTION_ENVIRONMENT = "egg-production";

/** The four secrets the workflow reads: the names are part of the file, never the values. */
export const WORKFLOW_SECRETS = {
  uploadPreview: "EGG_UPLOAD_PREVIEW_TOKEN",
  uploadProduction: "EGG_UPLOAD_PRODUCTION_TOKEN",
  envPreview: "EGG_ENV_PREVIEW_TOKEN",
  envProduction: "EGG_ENV_PRODUCTION_TOKEN",
} as const;

/**
 * What each secret holds: `credential` is the field of the build-credentials answer whose value goes in it, and
 * `store` is where it is saved on GitHub: the production ones in the `egg-production` environment, the
 * preview ones in the repository.
 */
export const WORKFLOW_SECRET_LIST = [
  { name: WORKFLOW_SECRETS.uploadProduction, credential: "productionUploadToken", store: "environment", purpose: "Sends a finished production build to Egg." },
  { name: WORKFLOW_SECRETS.envProduction, credential: "productionEnvToken", store: "environment", purpose: "Reads the production build variables." },
  { name: WORKFLOW_SECRETS.uploadPreview, credential: "previewUploadToken", store: "repository", purpose: "Sends a finished preview build to Egg." },
  { name: WORKFLOW_SECRETS.envPreview, credential: "previewEnvToken", store: "repository", purpose: "Reads the preview build variables." },
] as const;

export class WorkflowError extends Error {}

export type WorkflowInput = {
  /** Egg's own address (APP_URL). */
  eggUrl: string;
  productionBranch: string;
  runtime: Runtime;
  installCommand: string | null;
  buildCommand: string | null;
  outputDir: string | null;
  rootDir: string;
};

const BRANCH = /^[A-Za-z0-9._/-]+$/;

/**
 * Fetches the project's build variables from Egg and hands them to the later steps. The job gives it the one
 * credential for its environment as EGG_ENV_TOKEN, so a preview job holds no production credential. A value is
 * masked in the log before it is exported, and nothing from the response is printed. It uses Node's own fetch, so
 * the step needs no other tool. Exported so a test can run this exact text.
 */
export function envStepScript(target: "production" | "preview"): string {
  const production = target === "production";
  const secret = production ? WORKFLOW_SECRETS.envProduction : WORKFLOW_SECRETS.envPreview;
  const where = production
    ? "in the " + PRODUCTION_ENVIRONMENT + " environment under Settings, Environments"
    : "in the repository settings under Secrets and variables, Actions";
  return `const fs = require("node:fs");
const crypto = require("node:crypto");
const token = process.env.EGG_ENV_TOKEN;
const secret = "${secret}";
if (!token) {
  console.error("The " + secret + " secret is empty. Add it ${where}.");
  process.exit(1);
}
(async () => {
  const res = await fetch(process.env.EGG_URL + "/api/builds/env${production ? "" : "?env=preview"}", {
    headers: { authorization: "Bearer " + token },
  });
  if (!res.ok) {
    console.error("Egg answered " + res.status + " when asked for the build variables. Check the " + secret + " secret.");
    process.exit(1);
  }
  const vars = await res.json();
  let count = 0;
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value !== "string" || value === "" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    for (const line of value.split(/\\r?\\n/)) if (line !== "") console.log("::add-mask::" + line);
    const end = "EGG_" + crypto.randomBytes(16).toString("hex");
    fs.appendFileSync(process.env.GITHUB_ENV, key + "<<" + end + "\\n" + value + "\\n" + end + "\\n");
    count++;
  }
  console.log("Loaded " + count + " build variable" + (count === 1 ? "" : "s") + " from Egg.");
})().catch((err) => {
  console.error("Could not reach Egg: " + err.message);
  process.exit(1);
});`;
}

const UPLOAD_RETRIES = 6;
const UPLOAD_WAIT_SECONDS = 10;

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((l) => (l === "" ? l : pad + l))
    .join("\n");
}

const q = (value: string) => JSON.stringify(value);

/** Install with the package manager the lockfile names, in the order Egg's own build uses (pnpm, yarn, npm). */
const AUTO_INSTALL = `if [ -f package.json ]; then
  if [ -f pnpm-lock.yaml ]; then
    corepack enable && pnpm install --frozen-lockfile
  elif [ -f yarn.lock ]; then
    corepack enable && yarn install --frozen-lockfile
  elif [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
fi`;

/** Build only when package.json has a build script, with the same package manager choice. */
const AUTO_BUILD = `if [ -f package.json ] && node -e "process.exit(require('./package.json').scripts?.build ? 0 : 1)"; then
  if [ -f pnpm-lock.yaml ]; then
    corepack enable && pnpm build
  elif [ -f yarn.lock ]; then
    corepack enable && yarn build
  else
    npm run build
  fi
fi`;

function commands(i: WorkflowInput): { install: string | null; build: string | null } {
  const install = i.installCommand?.trim() || null;
  const build = i.buildCommand?.trim() || null;
  switch (i.runtime) {
    case "node":
    case "static":
      return { install: install ?? AUTO_INSTALL, build: build ?? AUTO_BUILD };
    case "python":
    case "command":
      return { install, build };
  }
}

/** The folder the archive is made from, relative to the folder the steps run in. */
function archiveDir(i: WorkflowInput): string {
  if (i.runtime !== "static") return ".";
  const out = i.outputDir?.trim();
  if (!out) return ".";
  const clean = cleanRootDir(out);
  if (clean === null) throw new WorkflowError("The output directory is not a valid relative path.");
  return clean === "" ? "." : clean;
}

function packExcludes(runtime: Runtime): string[] {
  switch (runtime) {
    case "node":
      return ["node_modules", ".git", ".github"];
    case "python":
      return [".venv", ".git", ".github"];
    case "static":
      return ["node_modules"];
    case "command":
      return [".git", ".github"];
  }
}

/** The exact workflow file for a project. Throws WorkflowError when a setting cannot be put in a file safely. */
export function buildWorkflow(i: WorkflowInput): string {
  let eggUrl: string;
  try {
    const u = new URL(i.eggUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
    eggUrl = u.origin;
  } catch {
    throw new WorkflowError("Egg's own address is not set to a valid URL.");
  }
  if (!BRANCH.test(i.productionBranch)) throw new WorkflowError("The production branch name is not valid.");
  const root = cleanRootDir(i.rootDir || ".");
  if (root === null) throw new WorkflowError("The root directory is not a valid relative path.");
  const dir = archiveDir(i);
  const { install, build } = commands(i);

  const setup: string[] = [];
  if (i.runtime === "node" || i.runtime === "static") {
    setup.push(
      "- name: Set up Node.js",
      "  uses: actions/setup-node@v4",
      "  with:",
      '    node-version: "lts/*"'
    );
  } else if (i.runtime === "python") {
    setup.push(
      "- name: Set up Python",
      "  uses: actions/setup-python@v5",
      "  with:",
      '    python-version: "3.x"'
    );
  }

  const excludes = packExcludes(i.runtime)
    .map((e) => `--exclude=${e}`)
    .join(" ");

  /** The steps of one job. Only the credentials differ: each job reads the two secrets of its own environment. */
  const stepsFor = (target: "production" | "preview"): string => {
    const production = target === "production";
    const steps: string[] = [
      "- name: Check out the code",
      "  uses: actions/checkout@v4",
      "  with:",
      "    persist-credentials: false",
      ...setup,
      "- name: Load the build variables from Egg",
      "  env:",
      "    EGG_ENV_TOKEN: ${{ secrets." + (production ? WORKFLOW_SECRETS.envProduction : WORKFLOW_SECRETS.envPreview) + " }}",
      "  run: |",
      "    node <<'EGG_ENV_SCRIPT'",
      indent(envStepScript(target), 4),
      "    EGG_ENV_SCRIPT",
    ];
    if (install) steps.push("- name: Install", "  run: |", indent(install, 4));
    if (build) steps.push("- name: Build", "  run: |", indent(build, 4));
    steps.push(
      "- name: Pack the release",
      "  run: |",
      "    set -eu",
      `    tar ${excludes} -czf "$RUNNER_TEMP/release.tar.gz" -C ${q(dir)} .`,
      '    echo "Packed $(stat -c %s "$RUNNER_TEMP/release.tar.gz") bytes."',
      "- name: Send the release to Egg",
      "  env:",
      "    EGG_UPLOAD_TOKEN: ${{ secrets." + (production ? WORKFLOW_SECRETS.uploadProduction : WORKFLOW_SECRETS.uploadPreview) + " }}",
      "    EGG_BRANCH: ${{ github.ref_name }}",
      "    EGG_COMMIT: ${{ github.sha }}",
      "  run: |",
      indent(uploadScript(), 4)
    );
    return indent(steps.join("\n"), 6);
  };

  /** What both jobs share before their steps. Only the production job names the environment. */
  const jobHead = (condition: string, environment: boolean): string[] => [
    `    if: ${condition}`,
    ...(environment ? [`    environment: ${PRODUCTION_ENVIRONMENT}`] : []),
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 30",
    ...(root ? ["    defaults:", "      run:", `        working-directory: ${q(root)}`] : []),
    "    steps:",
  ];

  // The branch name was checked against BRANCH above, so it holds nothing that could end the quoted string.
  const onProduction = `github.ref_name == '${i.productionBranch}'`;
  const onOther = `github.ref_name != '${i.productionBranch}'`;

  const lines = [
    "# Builds this project on GitHub and sends the finished release to Egg.",
    "# Made by Egg from this project's settings. Put it at " + WORKFLOW_PATH + " on the production branch.",
    "# It reads four secrets. Egg shows their values once, when you make the build credentials.",
    `#   In the "${PRODUCTION_ENVIRONMENT}" environment (Settings > Environments), limited to the production branch:`,
    `#     ${WORKFLOW_SECRETS.uploadProduction} and ${WORKFLOW_SECRETS.envProduction}.`,
    "#   In the repository (Settings > Secrets and variables > Actions), for preview builds:",
    `#     ${WORKFLOW_SECRETS.uploadPreview} and ${WORKFLOW_SECRETS.envPreview}.`,
    "# After upgrading from the earlier three-token workflow, make new build credentials and copy this workflow again.",
    "# Replace all four secrets, delete the old EGG_UPLOAD_TOKEN repository secret, and remove any repository-level EGG_ENV_PRODUCTION_TOKEN after adding it to the environment.",
    "# Do not save the two production values as repository secrets: every branch could then read them.",
    "# If you change the production branch, the build command or the runtime in Egg, copy this file again.",
    "name: Build for Egg",
    "",
    "on:",
    "  # Egg makes a deployment for a push to any branch: production for the production branch, a preview for others.",
    "  push:",
    '    branches: ["**"]',
    "  # To run by hand: deploy from Egg first so a deployment is waiting, then run this workflow on the same branch.",
    "  workflow_dispatch:",
    "",
    "permissions:",
    "  contents: read",
    "",
    "concurrency:",
    "  group: egg-${{ github.ref }}",
    "  cancel-in-progress: false",
    "",
    "env:",
    `  EGG_URL: ${q(eggUrl)}`,
    `  EGG_PRODUCTION_BRANCH: ${q(i.productionBranch)}`,
    "",
    "jobs:",
    "  build-production:",
    ...jobHead(onProduction, true),
    stepsFor("production"),
    "",
    "  build-preview:",
    ...jobHead(onOther, false),
    stepsFor("preview"),
  ];
  return lines.join("\n") + "\n";
}

/**
 * The upload, with the four headers the route requires. A deployment is made by the webhook a moment after the
 * push, so "no deployment is waiting" (409) and a busy Egg (429, 503) are tried again; anything else stops.
 */
export function uploadScript(): string {
  return `set -eu
file="$RUNNER_TEMP/release.tar.gz"
size=$(stat -c %s "$file")
if [ "$size" -gt ${MAX_ARCHIVE_BYTES} ]; then
  echo "The release is $size bytes. Egg accepts at most ${MAX_ARCHIVE_BYTES} bytes (500 MB)." >&2
  exit 1
fi
sha256=$(sha256sum "$file" | cut -d ' ' -f 1)
response="$RUNNER_TEMP/egg-response.json"
for attempt in $(seq 1 ${UPLOAD_RETRIES}); do
  status=$(curl -sS -o "$response" -w '%{http_code}' --request POST --upload-file "$file" \\
    -H "Authorization: Bearer $EGG_UPLOAD_TOKEN" \\
    -H "Content-Type: application/gzip" \\
    -H "X-Egg-Commit: $EGG_COMMIT" \\
    -H "X-Egg-Sha256: $sha256" \\
    -H "X-Egg-Branch: $EGG_BRANCH" \\
    -H "X-Egg-Run: $GITHUB_RUN_ID" \\
    "$EGG_URL/api/builds/upload" || true)
  if [ "$status" = "202" ]; then
    echo "Egg accepted the build."
    exit 0
  fi
  retry=0
  case "$status" in
    000|429|503) retry=1 ;;
    409) if grep -q no_deployment_waiting "$response"; then retry=1; fi ;;
  esac
  if [ "$retry" = "1" ] && [ "$attempt" -lt ${UPLOAD_RETRIES} ]; then
    echo "Egg answered $status. Trying again in ${UPLOAD_WAIT_SECONDS} seconds ($attempt of ${UPLOAD_RETRIES})."
    sleep ${UPLOAD_WAIT_SECONDS}
    continue
  fi
  echo "Egg answered $status:" >&2
  cat "$response" >&2 || true
  echo >&2
  exit 1
done`;
}

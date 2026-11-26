import { createHash } from "node:crypto";
import { and, count, eq, gt, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { repoNameOf } from "@/server/adoption";
import { open, seal, newId } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { envForDeployment } from "@/server/deploy/pipeline";
import { activateProduction, healthCheck, unitFile } from "@/server/deploy/remote";
import { currentEnvLink, currentLink, envFileOf, projectDir, releaseDir, unitName, RELEASE_ID } from "@/server/deploy/layout";
import { HttpError } from "@/server/http";
import { isFreshAuth, userForSessionToken } from "@/server/auth/session";
import { config } from "@/server/config";
import { MIN_FREE_DISK_MB } from "@/server/deploy/container-probe";
import { renderEnvFile, resolveStartCommand } from "@/server/deploy/runtime";
import { getProjectForUser } from "@/server/projects";
import { connectToServer, getServerForUser, type ServerRow } from "@/server/servers";
import { shellQuote, type NestSession } from "@/server/ssh/connection";
import { rateLimiter } from "@/server/rate-limit";
import { boundedImportCopy } from "@/server/import-copy";

const inputSchema = z.object({ unit: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}\.service$/).refine(x => !x.startsWith("egg-")), candidateId: z.string().uuid() }).strict();
const fail = (message: string) => new HttpError(409, message, "import_unsupported");
type Probe = { home: string; work: string; sha: string; unitHash: string; pid: string; group: string; enabled: "enabled" | "disabled" };
type Plan = { unit: string; candidateId: string; candidateRelease: string; candidatePort: number; probe: Probe; projectHash: string };

/** Returns hashes and metadata only: no unit contents, remote URL, environment, or command line. */
function probeScript(unit: string, repo: string, port: number): string {
  const q = shellQuote;
  return `set -euo pipefail
unit=${q(unit)}
repo=${q(repo)}
port=${port}
[ "$(systemctl is-active "$unit")" = active ] || exit 31
frag=$(systemctl show "$unit" -p FragmentPath --value)
work=$(systemctl show "$unit" -p WorkingDirectory --value)
pid=$(systemctl show "$unit" -p MainPID --value)
group=$(systemctl show "$unit" -p ControlGroup --value)
enabled=$(systemctl show "$unit" -p UnitFileState --value)
case "$enabled" in enabled|disabled) ;; *) exit 45;; esac
[ -n "$frag" ] && [ -f "$frag" ] && [ ! -L "$frag" ] && [ "$(realpath -e -- "$frag")" = "$frag" ] || exit 32
[ -n "$work" ] && [ -d "$work" ] && [ ! -L "$work" ] && [ "$(realpath -e -- "$work")" = "$work" ] || exit 33
case "$work" in "$HOME"/*) ;; *) exit 34;; esac
case "$work$HOME$group" in *$'\\n'*|*$'\\t'*) exit 35;; esac
[ -d "$work/.git" ] && [ ! -L "$work/.git" ] || exit 36
[ -z "$(systemctl show "$unit" -p EnvironmentFiles --value)" ] || exit 37
[ -z "$(git -C "$work" status --porcelain --untracked-files=normal)" ] || exit 38
repo_l=$(printf '%s' "$repo" | tr 'A-Z' 'a-z')
url=$(git -C "$work" config --get remote.origin.url | tr 'A-Z' 'a-z')
case "$url" in "https://github.com/$repo_l"|"https://github.com/$repo_l.git"|"git@github.com:$repo_l"|"git@github.com:$repo_l.git") ;; *) exit 39;; esac
sha=$(git -C "$work" rev-parse --verify HEAD)
hash=$(systemctl cat "$unit" | sha256sum | cut -d ' ' -f1)
printf 'ENABLED\\t%s\\n' "$enabled"
case "$pid" in ''|*[!0-9]*|0) exit 40;; esac
[ -n "$group" ] && [ "$group" != / ] || exit 41
listing=$(ss -H -ltnp "sport = :$port")
[ -n "$listing" ] || exit 42
pids=$(printf '%s\\n' "$listing" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
[ -n "$pids" ] || exit 43
for p in $pids; do awk -F: -v g="$group" '$3 == g || index($3, g "/") == 1 { ok=1 } END { exit !ok }' "/proc/$p/cgroup" || exit 44; done
printf 'HOME\\t%s\\nWORK\\t%s\\nSHA\\t%s\\nUNIT\\t%s\\nPID\\t%s\\nGROUP\\t%s\\n' "$HOME" "$work" "$sha" "$hash" "$pid" "$group"
`;
}
function parseProbe(value: string): Probe {
  const entries = new Map(value.trim().split("\n").map(line => { const [k, ...v] = line.split("\t"); return [k, v.join("\t")]; }));
  const state = entries.get("ENABLED");
  if (state !== "enabled" && state !== "disabled") throw fail("The original service's boot configuration could not be verified.");
  const p: Probe = { home: entries.get("HOME") ?? "", work: entries.get("WORK") ?? "", sha: entries.get("SHA") ?? "", unitHash: entries.get("UNIT") ?? "", pid: entries.get("PID") ?? "", group: entries.get("GROUP") ?? "", enabled: state };
  if (!p.home.startsWith("/") || !p.work.startsWith(`${p.home}/`) || !/^[0-9a-f]{40,64}$/.test(p.sha) || !/^[0-9a-f]{64}$/.test(p.unitHash) || !/^[1-9][0-9]*$/.test(p.pid) || !p.group.startsWith("/")) throw fail("Could not verify the service metadata; only a clean systemd Git checkout is supported.");
  return p;
}
async function inspect(session: NestSession, unit: string, repo: string, port: number): Promise<Probe> {
  const res = await session.script(probeScript(unit, repo, port), { timeoutMs: 60_000, maxOutputBytes: 32_000 });
  if (res.code !== 0) throw fail("Could not verify a clean systemd Git checkout and its listening port. PM2, Docker, environment files and non-Git apps are not supported.");
  return parseProbe(res.stdout);
}
function servicePortScript(unit: string, port: number): string {
  return `set -euo pipefail
unit=${shellQuote(unit)}
[ "$(systemctl show "$unit" -p ActiveState --value)" = active ]
group=$(systemctl show "$unit" -p ControlGroup --value)
[ -n "$group" ] && [ "$group" != / ]
listing=$(ss -H -ltnp 'sport = :${port}')
[ -n "$listing" ]
pids=$(printf '%s\n' "$listing" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
[ -n "$pids" ]
for p in $pids; do awk -F: -v g="$group" '$3 == g || index($3, g "/") == 1 { ok=1 } END { exit !ok }' "/proc/$p/cgroup"; done
`;
}
function hashProject(project: Awaited<ReturnType<typeof getProjectForUser>>, env: Record<string, string>) {
  return createHash("sha256").update(JSON.stringify({ project: { id: project.id, userId: project.userId, serverId: project.serverId, slug: project.slug, repoUrl: project.repoUrl, repoFullName: project.repoFullName, runtime: project.runtime, startCommand: project.startCommand, port: project.port, healthPath: project.healthPath }, env })).digest("hex");
}

export async function planImport(userId: string, projectId: string, raw: unknown,
  connect: (server: ServerRow) => Promise<NestSession> = connectToServer) {
  const input = inputSchema.parse(raw);
  const project = await getProjectForUser(userId, projectId);
  const budget = rateLimiter().check(`adoption-plan:${userId}`, 20, 60 * 60_000);
  if (!budget.allowed) throw new HttpError(429, "Too many import plans. Try again later.", "rate_limited", { "Retry-After": String(budget.retryAfterSeconds) });
  const repo = repoNameOf(project.repoFullName || project.repoUrl);
  if (!repo) throw fail("This import requires a GitHub repository with a clean checkout.");
  const db = await getDb();
  const candidate = await db.select().from(schema.deployments).where(and(eq(schema.deployments.id, input.candidateId), eq(schema.deployments.projectId, projectId), eq(schema.deployments.env, "preview"), eq(schema.deployments.state, "ready"))).get();
  if (project.workloadKind === "worker") throw fail("Importing an existing worker is not supported; create a new worker deployment instead.");
  if (!candidate?.commitSha || candidate.port === project.port || candidate.cleanedUp) throw fail("Choose a ready preview on a separate port with a known commit.");
  const server = await getServerForUser(userId, project.serverId);
  const session = await connect(server);
  try {
    const probe = await inspect(session, input.unit, repo, project.port);
    if (probe.sha !== candidate.commitSha) throw fail("The checkout commit does not match the ready preview commit.");
    const health = await session.script(healthCheck({ unit: unitName(project.slug, { releaseId: candidate.releaseId }), port: candidate.port, path: project.healthPath, timeoutSeconds: 10 }), { timeoutMs: 25_000 });
    if (health.code !== 0) throw fail("The candidate preview is not healthy.");
    const serving = await session.script(servicePortScript(unitName(project.slug, { releaseId: candidate.releaseId }), candidate.port), { timeoutMs: 15_000 });
    if (serving.code !== 0) throw fail("The candidate preview does not own its listening port.");
    const id = newId();
    const now = new Date();
    const plan: Plan = { unit: input.unit, candidateId: candidate.id, candidateRelease: candidate.releaseId, candidatePort: candidate.port, probe, projectHash: hashProject(project, await envForDeployment(projectId, "production")) };
    await db.transaction(async tx => {
      await tx.delete(schema.adoptionPlans).where(and(eq(schema.adoptionPlans.userId, userId),
        eq(schema.adoptionPlans.state, "planned"), lte(schema.adoptionPlans.expiresAt, now)));
      const total = await tx.select({ n: count() }).from(schema.adoptionPlans).where(and(eq(schema.adoptionPlans.userId, userId), eq(schema.adoptionPlans.state, "planned"))).get();
      if ((total?.n ?? 0) >= 20) throw new HttpError(409, "Review or let existing import plans expire first.", "limit");
      await tx.insert(schema.adoptionPlans).values({ id, userId, projectId, payloadEnc: seal(JSON.stringify(plan), `adoption:${id}`), state: "planned", createdAt: now, expiresAt: new Date(now.getTime() + 600_000) });
    });
    await audit(userId, "adoption.plan", projectId, { unit: input.unit, candidateId: candidate.id });
    return { id, expiresAt: new Date(now.getTime() + 600_000).toISOString(), unit: input.unit, workDir: probe.work, commit: probe.sha, port: project.port, candidateId: candidate.id,
      originalServiceDisabledOnSuccess: probe.enabled === "enabled", persistentData: "Original files and data stay in place. Configure explicit data paths; this flow does not migrate databases or uploads." };
  } finally { session.close(); }
}


/** Write a new file relative to a no-follow directory chain; data travels on stdin. */
async function writeExclusive(session: NestSession, path: string, content: string, replace: boolean) {
  const py = `import os,sys
p=sys.argv[1]; parts=p.split('/'); assert p.startswith('/') and all(x not in ('.','..') for x in parts)
d=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
for n in parts[1:-1]:
 if n: d2=os.open(n,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=d); os.close(d); d=d2
name=parts[-1]
if sys.argv[2]=='1':
 try: os.unlink(name,dir_fd=d)
 except FileNotFoundError: pass
f=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=d)
with os.fdopen(f,'wb') as out: out.write(sys.stdin.buffer.read()); out.flush(); os.fsync(out.fileno())
os.close(d)`;
  const r = await session.exec(`python3 -c ${shellQuote(py)} ${shellQuote(path)} ${replace ? "1" : "0"}`, { stdin: content, timeoutMs: 30_000 });
  if (r.code !== 0) throw new Error("Could not safely write the staged service configuration.");
}

/**
 * The most the import will copy, in MB. The cutover copies the whole preview release, installed dependencies
 * included, so a release this large would also not copy inside the time allowed. It matches the most a deploy
 * unpacks (MAX_SOURCE_UNPACKED_BYTES in deploy/build.ts). A larger release is refused before anything is copied.
 */
export const IMPORT_MAX_COPY_MB = 2048;
/** The copy is stopped on the container after this long, a little before the SSH command limit, so no copy runs on unseen. */
const COPY_SSH_TIMEOUT_MS = 120_000;

/** Reads the size of the release to copy and the free space where it goes. Changes nothing. */
export function copyRoomScript(src: string, base: string): string {
  const q = shellQuote;
  return `set -euo pipefail
src=${q(src)}
base=${q(base)}
command -v timeout >/dev/null 2>&1 || exit 50
[ -d "$src" ] && [ -d "$base" ] || exit 52
used=$(timeout 60 du -skl -- "$src" | awk 'NR==1 {print $1}')
free=$(df -Pk -- "$base" | awk 'NR==2 {print $4}')
case "$used" in ''|*[!0-9]*) exit 51;; esac
case "$free" in ''|*[!0-9]*) exit 51;; esac
printf 'SRC_KB\\t%s\\nFREE_KB\\t%s\\n' "$used" "$free"
`;
}

export type CopyRoom = { srcKb: number; freeKb: number };

export function parseCopyRoom(stdout: string): CopyRoom | null {
  const entries = new Map(stdout.trim().split("\n").map(line => { const [k, ...v] = line.split("\t"); return [k, v.join("\t").trim()]; }));
  const num = (k: string) => { const v = entries.get(k); return v && /^[0-9]+$/.test(v) ? Number(v) : null; };
  const srcKb = num("SRC_KB"), freeKb = num("FREE_KB");
  return srcKb === null || freeKb === null || !Number.isSafeInteger(srcKb) || !Number.isSafeInteger(freeKb) ? null : { srcKb, freeKb };
}

/** A plain refusal message, or null when the copy fits. The same free-space margin as the deploy preflight. */
export function copyRoomProblem(room: CopyRoom | null): string | null {
  const untouched = "Nothing was copied and your original service was not touched.";
  if (!room) return `Could not measure the preview release or the free disk space on your container. ${untouched} Try planning the import again.`;
  const srcMb = Math.ceil(room.srcKb / 1024);
  if (srcMb > IMPORT_MAX_COPY_MB) return `The preview release is ${srcMb} MB, over the ${IMPORT_MAX_COPY_MB} MB the import will copy. ${untouched} Make the app smaller, deploy a new preview and plan the import again.`;
  const leftMb = Math.floor((room.freeKb - room.srcKb) / 1024);
  if (leftMb < MIN_FREE_DISK_MB) return `Not enough free disk space on your container. The copy needs ${srcMb} MB and would leave ${Math.max(leftMb, 0)} MB free, but at least ${MIN_FREE_DISK_MB} MB must stay free. ${untouched} Free up disk space and plan the import again.`;
  return null;
}

/** Removes a partial copy. Only a release folder under this project's own releases folder is ever removed. */
export function removePartialCopyScript(base: string, dst: string): string {
  const q = shellQuote;
  return `set -euo pipefail
base=${q(base)}
dst=${q(dst)}
[ -f "$base/.egg-managed" ] && [ ! -L "$base" ]
[ ! -L "$base/.egg-managed" ] && [ "$(realpath -e -- "$base")" = "$base" ]
[ -d "$base/releases" ] && [ ! -L "$base/releases" ]
case "$dst" in "$base"/releases/?*) ;; *) exit 1;; esac
if [ -L "$dst" ]; then rm -f -- "$dst"; elif [ -e "$dst" ]; then rm -rf -- "$dst"; fi
[ ! -e "$dst" ] && [ ! -L "$dst" ]
`;
}

/** Confirming a plan is a one-shot remote mutation, guarded until success or confirmed rollback. */
export async function confirmImport(userId: string, projectId: string, planId: string, raw: unknown, token: string | undefined,
  connect: (server: ServerRow) => Promise<NestSession> = server => connectToServer(server, { adoptionExecutor: true })): Promise<void> {
  z.object({ confirm: z.literal(true) }).strict().parse(raw);
  if ((await userForSessionToken(token))?.id !== userId || !(await isFreshAuth(token))) throw new HttpError(403, "Confirm a fresh Hack Club sign-in before cutover.", "reauth_required");
  const project = await getProjectForUser(userId, projectId);
  if (project.runtime === "python") throw fail("Python virtual environments cannot safely be copied; use a supported Node, static or command project.");
  const server = await getServerForUser(userId, project.serverId);
  const db = await getDb();
  const id = newId(), release = newId(), jobId = newId(), opId = newId();
  const now = new Date();
  const guard = `adoption:${planId}`;
  let plan!: Plan;
  let session: NestSession | undefined;
  let staged = false;
  let foreignMayBeStopped = false;
  let resolved = false;
  let generatedUnit = "";
  const prodUnit = unitName(project.slug);
  const unitDir = config().UNIT_DIR;
  await audit(userId, "adoption.confirm_attempt", projectId, { planId });
  try {
    await db.transaction(async tx => {
      const row = await tx.select().from(schema.adoptionPlans).where(and(eq(schema.adoptionPlans.id, planId), eq(schema.adoptionPlans.userId, userId), eq(schema.adoptionPlans.projectId, projectId), eq(schema.adoptionPlans.state, "planned"), gt(schema.adoptionPlans.expiresAt, now))).get();
      if (!row) throw fail("The import plan expired, was already used, or does not belong to this project.");
      plan = JSON.parse(open(row.payloadEnc, `adoption:${planId}`)) as Plan;
      if (!RELEASE_ID.test(plan.candidateRelease)) throw fail("The candidate release is invalid.");
      const candidate = await tx.select().from(schema.deployments).where(and(eq(schema.deployments.id, plan.candidateId), eq(schema.deployments.projectId, projectId), eq(schema.deployments.state, "ready"), eq(schema.deployments.env, "preview"))).get();
      if (!candidate || candidate.cleanedUp || candidate.releaseId !== plan.candidateRelease || candidate.port !== plan.candidatePort || candidate.commitSha !== plan.probe.sha) throw fail("The candidate changed; create a new plan.");
      const current = await tx.select({ id: schema.deployments.id }).from(schema.deployments).where(and(eq(schema.deployments.projectId, projectId), eq(schema.deployments.isCurrent, true))).get();
      if (current) throw fail("Import requires a project without an existing production release.");
      const running = await tx.select({ id: schema.jobs.id }).from(schema.jobs).innerJoin(schema.deployments, eq(schema.deployments.id, schema.jobs.deploymentId)).where(and(eq(schema.deployments.projectId, projectId), eq(schema.jobs.state, "running"))).get();
      const operations = await tx.select({ id: schema.cleanupOperations.id }).from(schema.cleanupOperations).where(eq(schema.cleanupOperations.serverId, server.id)).get();
      const cleanup = await tx.select({ id: schema.cleanupJobs.id }).from(schema.cleanupJobs).where(and(eq(schema.cleanupJobs.userId, userId), inArray(schema.cleanupJobs.state, ["draining", "running", "failed"]))).get();
      const other = await tx.select({ id: schema.adoptionPlans.id }).from(schema.adoptionPlans).innerJoin(schema.projects, eq(schema.projects.id, schema.adoptionPlans.projectId)).where(and(eq(schema.projects.serverId, server.id), eq(schema.adoptionPlans.state, "executing"))).get();
      if (running || operations || cleanup || other) throw fail("Another deployment, cleanup, cutover, or remote operation is active; try again later.");
      const claimed = await tx.update(schema.adoptionPlans).set({ state: "executing", confirmedAt: now }).where(and(eq(schema.adoptionPlans.id, planId), eq(schema.adoptionPlans.state, "planned"), gt(schema.adoptionPlans.expiresAt, now))).returning({ id: schema.adoptionPlans.id });
      if (!claimed.length) throw fail("The plan was already used or expired.");
      await tx.insert(schema.cleanupOperations).values({ id: opId, userId, serverId: server.id, openedAt: now });
      await tx.insert(schema.deployments).values({ id, projectId, env: "production", state: "deploying", source: "manual", branch: candidate.branch, commitSha: candidate.commitSha, port: project.port, releaseId: release, createdAt: now, startedAt: now, activationStartedAt: now });
      await tx.insert(schema.jobs).values({ id: jobId, type: "deploy", deploymentId: id, projectId, state: "running", lockedBy: guard, lockedAt: now, createdAt: now });
    });
    const liveProject = await getProjectForUser(userId, projectId);
    const env = await envForDeployment(projectId, "production");
    if (hashProject(liveProject, env) !== plan.projectHash) throw fail("Project configuration changed; create a new plan.");
    const repo = repoNameOf(liveProject.repoFullName || liveProject.repoUrl);
    if (!repo) throw fail("Repository changed; create a new plan.");
    session = await connect(server);
    const found = await inspect(session, plan.unit, repo, project.port);
    if (JSON.stringify(found) !== JSON.stringify(plan.probe)) throw fail("The original service or checkout changed; create a new plan.");
    const health = await session.script(healthCheck({ unit: unitName(project.slug, { releaseId: plan.candidateRelease }), port: plan.candidatePort, path: project.healthPath, timeoutSeconds: 10 }), { timeoutMs: 25_000 });
    if (health.code !== 0) throw fail("The candidate preview is no longer healthy.");
    const serving = await session.script(servicePortScript(unitName(project.slug, { releaseId: plan.candidateRelease }), plan.candidatePort), { timeoutMs: 15_000 });
    if (serving.code !== 0) throw fail("The candidate preview no longer owns its port.");
    const src = releaseDir(found.home, project.slug, plan.candidateRelease);
    const dst = releaseDir(found.home, project.slug, release);
    const base = projectDir(found.home, project.slug);
    const unitPath = `${unitDir}/${prodUnit}`;
    // Before anything is copied, stopped or switched: is there room, and is the release a sensible size?
    const room = await session.script(copyRoomScript(src, base), { timeoutMs: 90_000, maxOutputBytes: 4_000 });
    const roomProblem = copyRoomProblem(room.code === 0 ? parseCopyRoom(room.stdout) : null);
    if (roomProblem) throw fail(roomProblem);
    const copy = `set -euo pipefail
base=${shellQuote(base)}
src=${shellQuote(src)}
dst=${shellQuote(dst)}
unit=${shellQuote(unitPath)}
link=${shellQuote(currentLink(found.home, project.slug))}
[ -f "$base/.egg-managed" ] && [ ! -L "$base" ] && [ "$(realpath -e "$base")" = "$base" ]
[ -d "$src" ] && [ ! -L "$src" ] && [ "$(realpath -e "$src")" = "$src" ]
[ ! -L "$base/env" ] && { [ ! -e "$base/env" ] || [ -d "$base/env" ]; }
if [ ! -d "$base/env" ]; then mkdir -m 700 -- "$base/env"; fi
[ ! -e "$dst" ] && [ ! -L "$dst" ] && [ ! -e "$unit" ] && [ ! -L "$unit" ] && [ ! -e "$link" ] && [ ! -L "$link" ]
${boundedImportCopy(src, dst, base, IMPORT_MAX_COPY_MB * 1024 * 1024, MIN_FREE_DISK_MB * 1024 * 1024)}
`;
    staged = true; // An SSH error may mean a partial copy exists.
    let copyError: unknown = null;
    try {
      const copied = await session.script(copy, { timeoutMs: COPY_SSH_TIMEOUT_MS });
      if (copied.code !== 0) copyError = new Error("Could not copy the preview release.");
    } catch (e) { copyError = e; }
    if (copyError) {
      // Take the partial copy away. Only when that is confirmed is the guard released: nothing else was changed yet.
      const removed = await session.script(removePartialCopyScript(base, dst), { timeoutMs: 120_000 }).catch(() => null);
      if (removed?.code === 0) staged = false;
      throw removed?.code === 0
        ? fail("The preview release could not be copied (it may have taken too long), so the import was stopped. The partial copy was removed and your original service was not touched. Try again, or make the app smaller.")
        : new Error("Could not copy the preview release, and the partial copy could not be confirmed removed; the guard remains in place.");
    }
    await writeExclusive(session, envFileOf(found.home, project.slug, release), renderEnvFile(env), false);
    const command = resolveStartCommand(project, server.probe ? JSON.parse(server.probe) : null, project.port);
    generatedUnit = unitFile({ slug: project.slug, description: `Egg: ${project.name}`, workDir: currentLink(found.home, project.slug), envFile: currentEnvLink(found.home, project.slug), port: project.port, startCommand: command });
    await writeExclusive(session, unitPath, generatedUnit, false);
    const stop = `${probeScript(plan.unit, repo, project.port)}\n[ "$sha" = ${shellQuote(plan.probe.sha)} ] && [ "$hash" = ${shellQuote(plan.probe.unitHash)} ] && [ "$pid" = ${shellQuote(plan.probe.pid)} ] && [ "$group" = ${shellQuote(plan.probe.group)} ] && [ "$work" = ${shellQuote(plan.probe.work)} ]\nsystemctl stop ${shellQuote(plan.unit)}\nstate=$(systemctl show ${shellQuote(plan.unit)} -p ActiveState --value)\n[ "$state" = inactive ] || [ "$state" = failed ]\n[ -z "$(ss -H -ltn 'sport = :${project.port}')" ]\n`;
    foreignMayBeStopped = true;
    const stopped = await session.script(stop, { timeoutMs: 60_000 });
    if (stopped.code !== 0) throw new Error("The original service could not be confirmed stopped.");
    const activate = `set -euo pipefail\nsystemctl daemon-reload\nsystemctl enable ${shellQuote(prodUnit)}\n` + activateProduction({ home: found.home, slug: project.slug, releaseId: release, unit: prodUnit, unitDir, restoreUnitFile: null });
    const activated = await session.script(activate, { timeoutMs: 120_000 });
    if (activated.code !== 0) throw new Error("The new service did not start.");
    const ready = await session.script(healthCheck({ unit: prodUnit, port: project.port, path: project.healthPath, timeoutSeconds: 45 }), { timeoutMs: 60_000 });
    if (ready.code !== 0) throw new Error("The new service did not become healthy.");
    const productionServing = await session.script(servicePortScript(prodUnit, project.port), { timeoutMs: 15_000 });
    if (productionServing.code !== 0) throw new Error("The new service does not own the production port.");
    if (plan.probe.enabled === "enabled") {
      const disabled = await session.script(`set -euo pipefail\nsystemctl disable ${shellQuote(plan.unit)}\n[ "$(systemctl show ${shellQuote(plan.unit)} -p UnitFileState --value)" = disabled ]\n`, { timeoutMs: 30_000 });
      if (disabled.code !== 0) throw new Error("Could not prevent the original service restarting at boot.");
    }
    await db.transaction(async tx => {
      const updated = await tx.update(schema.adoptionPlans).set({ state: "completed" }).where(and(eq(schema.adoptionPlans.id, planId), eq(schema.adoptionPlans.state, "executing"))).returning({ id: schema.adoptionPlans.id });
      if (!updated.length) throw new Error("The cutover guard changed unexpectedly.");
      await tx.update(schema.deployments).set({ state: "ready", isCurrent: true, finishedAt: new Date() }).where(eq(schema.deployments.id, id));
      await tx.update(schema.jobs).set({ state: "done" }).where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.lockedBy, guard)));
      await tx.delete(schema.cleanupOperations).where(eq(schema.cleanupOperations.id, opId));
    });
    resolved = true;
    await audit(userId, "adoption.complete", projectId, { planId, deploymentId: id, unit: plan.unit });
  } catch (error) {
    // Before any remote write, the failure is known safe. After a stop request,
    // release the guard only when both production stop and original restart are verified.
    if (foreignMayBeStopped && session && generatedUnit) {
      const hash = createHash("sha256").update(generatedUnit).digest("hex");
      const unitPath = `${unitDir}/${prodUnit}`;
      const link = currentLink(plan.probe.home, project.slug);
      const dst = releaseDir(plan.probe.home, project.slug, release);
      const rollback = `set -euo pipefail\nf=${shellQuote(unitPath)}\n[ -f "$f" ] && [ ! -L "$f" ] && [ "$(sha256sum "$f" | cut -d ' ' -f1)" = ${shellQuote(hash)} ]\nsystemctl stop ${shellQuote(prodUnit)} || true\ns=$(systemctl show ${shellQuote(prodUnit)} -p ActiveState --value)\n[ "$s" = inactive ] || [ "$s" = failed ]\nsystemctl disable ${shellQuote(prodUnit)} >/dev/null 2>&1 || true\nrm -f -- "$f"\nif [ -L ${shellQuote(link)} ]; then [ "$(readlink ${shellQuote(link)})" = ${shellQuote(dst)} ] || exit 1; rm -- ${shellQuote(link)}; elif [ -e ${shellQuote(link)} ]; then exit 1; fi\nsystemctl daemon-reload\n[ "$(systemctl cat ${shellQuote(plan.unit)} | sha256sum | cut -d ' ' -f1)" = ${shellQuote(plan.probe.unitHash)} ]\nsystemctl start ${shellQuote(plan.unit)}\n`;
      try {
        const restoreBoot = plan.probe.enabled === "enabled" ? `systemctl enable ${shellQuote(plan.unit)}\n` : "";
        const runtimeEnv = envFileOf(plan.probe.home, project.slug, release);
        const runtimeLink = currentEnvLink(plan.probe.home, project.slug);
        const removeRuntimeEnv = `if [ -L ${shellQuote(runtimeLink)} ]; then [ "$(readlink ${shellQuote(runtimeLink)})" = ${shellQuote(runtimeEnv)} ] || exit 1; rm -f -- ${shellQuote(runtimeLink)}; elif [ -e ${shellQuote(runtimeLink)} ]; then exit 1; fi\n[ ! -L ${shellQuote(`${projectDir(plan.probe.home, project.slug)}/env`)} ] || exit 1\nrm -f -- ${shellQuote(runtimeEnv)}\n`;
        const back = await session.script(rollback + removeRuntimeEnv + restoreBoot, { timeoutMs: 120_000 });
        const health = back.code === 0 ? await session.script(healthCheck({ unit: plan.unit, port: project.port, path: project.healthPath, timeoutSeconds: 45 }), { timeoutMs: 60_000 }) : null;
        const originalServing = back.code === 0 && health?.code === 0 ? await session.script(servicePortScript(plan.unit, project.port), { timeoutMs: 15_000 }) : null;
        if (back.code === 0 && health?.code === 0 && originalServing?.code === 0) resolved = true;
      } catch { /* Keep durable guard on an uncertain rollback. */ }
    } else if (!staged) resolved = true;
    if (resolved) {
      await db.transaction(async tx => {
        await tx.update(schema.adoptionPlans).set({ state: "failed", error: "Cutover failed; original service was left running or restored." }).where(and(eq(schema.adoptionPlans.id, planId), eq(schema.adoptionPlans.state, "executing")));
        await tx.update(schema.deployments).set({ state: "error", error: "Import did not complete.", finishedAt: new Date() }).where(eq(schema.deployments.id, id));
        await tx.update(schema.jobs).set({ state: "failed", error: "Import did not complete." }).where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.lockedBy, guard)));
        await tx.delete(schema.cleanupOperations).where(eq(schema.cleanupOperations.id, opId));
      });
    }
    await audit(userId, "adoption.failed", projectId, { planId, guardRetained: !resolved });
    throw error;
  } finally { session?.close(); }
}

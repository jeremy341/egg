import { rmSync } from "node:fs";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { open } from "@/server/crypto";
import { receiveGithubRelease } from "@/server/builds/release";
import { GithubBuildError, discardUpload } from "@/server/builds/uploads";
import { config, githubConfigured } from "@/server/config";
import { installationToken } from "@/server/github/app";
import { getDb, schema } from "@/server/db";
import { defaultSourceBuilder, type Builder } from "@/server/deploy/build";
import { BuildLockError } from "@/server/deploy/build-lock";
import { ContainerBuildError, checkContainerReady, discardBuildScript, runContainerBuild } from "@/server/deploy/container-build";
import { preflightNeeds, sessionPreflight, type PreflightRunner } from "@/server/deploy/container-probe";
import {
  DEFAULT_UNIT_DIR,
  KEEP_PREVIEWS,
  KEEP_RELEASES,
  currentEnvLink,
  currentLink,
  envFileOf,
  releaseDir,
  unitName,
} from "@/server/deploy/layout";
import { blockingConflicts, probeConflicts, repoNameOf } from "@/server/adoption";
import { npmCachePlan } from "@/server/deploy/download-cache";
import { deploymentRecorder, measureStage } from "@/server/deploy/performance";
import { DeploymentLogger } from "@/server/deploy/logger";
import { getProjectRole } from "@/server/project-roles";
import * as remote from "@/server/deploy/remote";
import {
  ENV_KEY,
  RESERVED_ENV,
  StartCommandError,
  renderEnvFile,
  resolveStartCommand,
} from "@/server/deploy/runtime";
import { commentDeploymentOnPr } from "@/server/github/pulls";
import { notifyDeploymentFinished } from "@/server/notify";
import { dispatchDeploymentEvent } from "@/server/webhooks";
import { connectToServer, type ServerRow } from "@/server/servers";
import { shellQuote, type NestSession } from "@/server/ssh/connection";
import { probeSession, type NestProbe } from "@/server/ssh/probe";
import { buildCpuRange, reportedCpus, reportedMemoryMb } from "@/lib/build-memory";

export class DeployError extends Error {}

export type PipelineDeps = {
  /** Clone and pack the source only; the install and build run on the container. Defaults to the real one. */
  sourceBuild?: Builder;
  /** The check run on the container before anything is uploaded. Defaults to the real script. */
  preflight?: (session: NestSession) => PreflightRunner;
  /** How often a build waits to look at the container's build lock again, in ms. */
  lockPollMs?: number;
  /** GitHub builds: how long a deployment waits for the release to arrive, and how often it looks. Defaults: 60 minutes, 10 seconds. */
  githubWait?: { timeoutMs?: number; pollMs?: number };
  connect: (server: ServerRow) => Promise<NestSession>;
  /** Short-lived GitHub token for a private repo, if the App is set up. */
  installationToken?: (installationId: number) => Promise<string>;
  unitDir: string;
  healthTimeoutSeconds: number;
};

export function defaultDeps(): PipelineDeps {
  return {
    sourceBuild: defaultSourceBuilder,
    connect: (server) => connectToServer(server, { allowDuringCleanup: true }),
    installationToken: githubConfigured() ? (id) => installationToken(id) : undefined,
    unitDir: config().UNIT_DIR || DEFAULT_UNIT_DIR,
    healthTimeoutSeconds: 45,
  };
}

type Project = typeof schema.projects.$inferSelect;
type Deployment = typeof schema.deployments.$inferSelect;

async function load(deploymentId: string) {
  const db = await getDb();
  const dep = await db
    .select()
    .from(schema.deployments)
    .where(eq(schema.deployments.id, deploymentId))
    .get();
  if (!dep) throw new DeployError("Deployment not found");
  const project = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, dep.projectId))
    .get();
  if (!project) throw new DeployError("Project not found");
  const server = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, project.serverId))
    .get();
  if (!server) throw new DeployError("Server not found");
  return { db, dep, project, server };
}

/** Decrypted variables for one environment, minus names we reserve. */
export function mergeEnvForDeployment(
  rows: Array<{ key: string; target: "all" | "production" | "preview"; value: string }>,
  env: "production" | "preview"
): Record<string, string> {
  const out: Record<string, string> = {};
  const specificity = new Map<string, number>();
  for (const row of rows) {
    if (!ENV_KEY.test(row.key) || RESERVED_ENV.has(row.key)) continue;
    if (row.target !== "all" && row.target !== env) continue;
    const rank = row.target === env ? 1 : 0;
    if ((specificity.get(row.key) ?? -1) > rank) continue;
    out[row.key] = row.value;
    specificity.set(row.key, rank);
  }
  return out;
}

export async function envForDeployment(
  projectId: string,
  env: "production" | "preview"
): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.envVars)
    .where(eq(schema.envVars.projectId, projectId));
  return mergeEnvForDeployment(
    rows.map((r) => ({ ...r, value: open(r.valueEnc, `env:${projectId}:${r.key}:${r.target}`) })),
    env
  );
}

/**
 * Move a deployment to a new state. A canceled deployment stays canceled: the
 * cancel button writes the state straight to the database while this worker is
 * mid-step, so a later "deploying" or "ready" must not overwrite it. Returns
 * false when the move was refused for that reason. `released` is for a release
 * that is already live: it is finished as ready even if a cancel arrived late,
 * because "canceled" on a running release would hide it from rollback.
 */
async function setState(
  id: string,
  state: Deployment["state"],
  extra: Partial<typeof schema.deployments.$inferInsert> = {},
  released = false
): Promise<boolean> {
  const db = await getDb();
  const where =
    state === "canceled" || released
      ? eq(schema.deployments.id, id)
      : and(eq(schema.deployments.id, id), ne(schema.deployments.state, "canceled"));
  const moved = await db
    .update(schema.deployments)
    .set({ state, ...extra, ...(state === "canceled" ? {
      // Keep durable PR-close cleanup intent when a canceled worker exits.
      error: sql`coalesce(${schema.deployments.error}, ${extra.error ?? null})`,
    } : {}) })
    .where(where)
    .returning({ id: schema.deployments.id });
  if (moved.length === 0) return false;
  void dispatchDeploymentEvent(id, { state }); // outbound webhooks; never throws
  if (state === "ready" || state === "error") {
    // Fire and forget: notifyDeploymentFinished never throws.
    void notifyDeploymentFinished(id);
    void commentDeploymentOnPr(id);
  }
  return true;
}

async function stateOf(id: string) {
  const db = await getDb();
  return (
    await db.select({ s: schema.deployments.state }).from(schema.deployments).where(eq(schema.deployments.id, id)).get()
  )?.s;
}

/** Atomically win the activation boundary against a concurrent user cancel. */
async function beginActivation(id: string): Promise<boolean> {
  const db = await getDb();
  const moved = await db
    .update(schema.deployments)
    .set({ activationStartedAt: new Date() })
    .where(
      and(
        eq(schema.deployments.id, id),
        eq(schema.deployments.state, "deploying"),
        isNull(schema.deployments.activationStartedAt)
      )
    )
    .returning({ id: schema.deployments.id });
  return moved.length === 1;
}

/** Run a script on the container, streaming output into the log. */
async function run(
  session: NestSession,
  log: DeploymentLogger,
  label: string,
  script: string,
  timeoutMs = 120_000,
  signal?: AbortSignal
) {
  const res = await session.script(script, {
    timeoutMs,
    signal,
    outputTailBytes: 65536,
    onLine: (l, stream) => (stream === "stderr" ? log.warn(l) : log.info(l)),
  });
  if (res.code === remote.NOT_OURS_EXIT) {
    // Something on the container is not ours. The script says what, in plain words.
    throw new DeployError(
      res.stderr.trim().slice(0, 300) || `${label} stopped: it would overwrite something Egg did not create.`
    );
  }
  if (res.code !== 0) {
    throw new DeployError(`${label} failed (exit ${res.code}).`);
  }
  return res;
}

async function getProbe(session: NestSession, server: ServerRow): Promise<NestProbe> {
  const probe = await probeSession(session);
  const db = await getDb();
  await db
    .update(schema.servers)
    .set({ probe: JSON.stringify(probe), lastCheckedAt: new Date() })
    .where(eq(schema.servers.id, server.id));
  return probe;
}

function unitPaths(project: Project, dep: Deployment, home: string) {
  const preview = dep.env === "preview" ? { releaseId: dep.releaseId } : undefined;
  const unit = unitName(project.slug, preview);
  const workDir = preview
    ? releaseDir(home, project.slug, dep.releaseId)
    : currentLink(home, project.slug);
  // The variables file is never inside the release folder (a static app serves that folder).
  // A preview reads its own file; production reads the current.env link, which follows `current`.
  const envFile = preview ? envFileOf(home, project.slug, dep.releaseId) : currentEnvLink(home, project.slug);
  return { unit, workDir, envFile };
}

async function healthy(
  session: NestSession,
  log: DeploymentLogger,
  unit: string,
  port: number,
  path: string,
  timeoutSeconds: number
): Promise<boolean> {
  const res = await session.script(
    remote.healthCheck({ unit, port, path, timeoutSeconds }),
    {
      timeoutMs: (timeoutSeconds + 15) * 1000,
      onLine: (l) => log.info(l),
    }
  );
  return res.code === 0;
}

async function logJournal(session: NestSession, log: DeploymentLogger, unit: string) {
  log.warn(`Last log lines from ${unit}:`);
  await session
    .script(remote.journalTail(unit, 30), { timeoutMs: 20_000, onLine: (l) => log.warn(l) })
    .catch(() => {});
}

/** The production deployment currently serving traffic, if any. */
async function currentProduction(projectId: string, excludeId?: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.deployments)
    .where(
      and(
        eq(schema.deployments.projectId, projectId),
        eq(schema.deployments.env, "production"),
        eq(schema.deployments.isCurrent, true)
      )
    );
  return rows.find((r) => r.id !== excludeId) ?? null;
}

async function markCurrent(projectId: string, deploymentId: string) {
  const db = await getDb();
  await db
    .update(schema.deployments)
    .set({ isCurrent: false })
    .where(
      and(eq(schema.deployments.projectId, projectId), eq(schema.deployments.env, "production"))
    );
  await db
    .update(schema.deployments)
    .set({ isCurrent: true })
    .where(eq(schema.deployments.id, deploymentId));
}

/** Remove old releases and previews, on the server and in the records. */
async function cleanup(
  session: NestSession,
  log: DeploymentLogger,
  project: Project,
  home: string,
  unitDir: string,
  currentReleaseId: string | null
) {
  const db = await getDb();
  const all = await db
    .select()
    .from(schema.deployments)
    .where(
      and(
        eq(schema.deployments.projectId, project.id),
        eq(schema.deployments.state, "ready"),
        eq(schema.deployments.cleanedUp, false)
      )
    )
    .orderBy(desc(schema.deployments.createdAt));

  // Previews: keep the newest few, stop the rest.
  const previews = all.filter((d) => d.env === "preview");
  const previewsWithFailedCleanup = new Set<string>();
  for (const old of previews.slice(KEEP_PREVIEWS)) {
    log.info(`Removing old preview ${old.releaseId.slice(0, 8)}`);
    const removed = await session
      .script(
        remote.removePreview({
          home,
          slug: project.slug,
          releaseId: old.releaseId,
          unit: unitName(project.slug, { releaseId: old.releaseId }),
          unitDir,
        }),
        { timeoutMs: 60_000 }
      )
      .then((result) => result.code === 0)
      .catch(() => false);
    if (removed) {
      await db.update(schema.deployments).set({ cleanedUp: true }).where(eq(schema.deployments.id, old.id));
    } else {
      previewsWithFailedCleanup.add(old.releaseId);
    }
  }
  const keptPreviewReleases = previews.slice(0, KEEP_PREVIEWS).map((d) => d.releaseId);

  // Production: keep the newest few distinct releases plus the current one.
  const keep = new Set<string>([...keptPreviewReleases, ...previewsWithFailedCleanup]);
  if (currentReleaseId) keep.add(currentReleaseId);
  const seen = new Set<string>();
  for (const d of all.filter((x) => x.env === "production")) {
    if (seen.size >= KEEP_RELEASES) break;
    seen.add(d.releaseId);
  }
  for (const r of seen) keep.add(r);

  // A build of this project that is running right now keeps its variables file. (A project has one
  // deploy at a time, so this is normally empty; the file of an interrupted build is removed.)
  const building = (
    await db
      .select({ releaseId: schema.deployments.releaseId })
      .from(schema.deployments)
      .where(and(eq(schema.deployments.projectId, project.id), inArray(schema.deployments.state, ["building", "deploying"])))
  ).map((d) => d.releaseId);

  await session
    .script(remote.pruneReleases(home, project.slug, [...keep], building, unitDir), {
      timeoutMs: 120_000,
      onLine: (l) => log.info(l),
    })
    .catch(() => {});

  for (const d of all.filter((x) => x.env === "production" && !keep.has(x.releaseId))) {
    await db.update(schema.deployments).set({ cleanedUp: true }).where(eq(schema.deployments.id, d.id));
  }
}

function throwIfCanceled(signal: AbortSignal) {
  if (signal.aborted) throw new DeployError("The deployment was canceled.");
}

/** Build the project and release it. */
export async function runDeployJob(
  deploymentId: string,
  deps: PipelineDeps = defaultDeps(),
  signal: AbortSignal = new AbortController().signal
): Promise<void> {
  const { db, dep, project, server } = await load(deploymentId);
  const log = new DeploymentLogger(deploymentId);
  const recordStage = deploymentRecorder(deploymentId);
  let workDir: string | null = null;
  let session: NestSession | null = null;
  let previewUnitWritten = false;
  // Set once the release folder exists, so a failure before the switch can remove the folder it built.
  let releaseBuilt = false;
  let productionUnitWritten = false;
  let productionActivated = false;
  let productionUnitName: string | null = null;
  let previousUnitFile: string | null = null;
  let nextProductionUnitFile: string | null = null;
  // A GitHub build: the release is uploaded by the project's workflow, and nothing is cloned or built here.
  const githubBuild = project.buildLocation === "github";
  let ownsUpload = false;

  try {
    if ((await stateOf(deploymentId)) !== "queued") return;
    if (dep.triggeredBy && dep.triggeredBy !== project.userId && await getProjectRole(dep.triggeredBy, project.id) !== "developer") {
      throw new DeployError("The deployment actor no longer has permission to deploy this project.");
    }
    if (!(await setState(deploymentId, "building", { startedAt: new Date() }))) return;
    ownsUpload = githubBuild;
    log.info(
      `Deploying ${project.name} (${dep.env}) to ${server.nestUsername}@${server.host}`
    );

    const env = await envForDeployment(project.id, dep.env);
    const token =
      !githubBuild && project.installationId && deps.installationToken
        ? await deps.installationToken(project.installationId)
        : null;
    log.setSecrets([...Object.values(env), token ?? ""]);

    // ---- source (on this machine). Egg only clones and packs the source here; the install and build
    // run later on the Nest container, under a memory and CPU cap. No project is built on Egg's machine.
    const built = await measureStage("source", async () => githubBuild
      ? await receiveGithubRelease({
          deploymentId,
          commit: dep.commitSha,
          branch: dep.branch,
          runtime: {
            runtime: project.runtime,
            installCommand: project.installCommand,
            buildCommand: project.buildCommand,
            startCommand: project.startCommand,
            outputDir: project.outputDir,
          },
          log,
          signal,
          // Anything but "building" (canceled, or the deployment removed) ends the wait.
          isCanceled: async () => (await stateOf(deploymentId)) !== "building",
          wait: deps.githubWait,
        })
      : await (deps.sourceBuild ?? defaultSourceBuilder)({
        deploymentId,
        enableDownloadCache: project.buildCacheEnabled,
        runtime: {
          runtime: project.runtime,
          installCommand: project.installCommand,
          buildCommand: project.buildCommand,
          startCommand: project.startCommand,
          outputDir: project.outputDir,
        },
        rootDir: project.rootDir,
        source: {
          cloneUrl: project.repoUrl,
          token,
          branch: dep.branch,
          sha: dep.source === "redeploy" ? dep.commitSha : null,
        },
        env,
        log: log.log,
        signal,
      }), recordStage);
    workDir = built.workDir || null;
    throwIfCanceled(signal);
    await db
      .update(schema.deployments)
      .set({
        commitSha: built.commit.sha,
        commitMessage: githubBuild
          ? dep.commitMessage || `Built on GitHub Actions (run ${"run" in built ? built.run : ""})`
          : built.commit.message,
        author: built.commit.author || dep.author,
        archiveBytes: built.sizeBytes,
      })
      .where(eq(schema.deployments.id, deploymentId));

    // ---- release on Nest
    // The deployment stays "building" until the build has finished on the container.
    log.info("Connecting to your Nest container");
    session = await deps.connect(server);
    throwIfCanceled(signal);
    const probe = await getProbe(session, server);
    const home = probe.home;
    const unitInfo = unitPaths(project, dep, home);
    productionUnitName = unitInfo.unit;

    let startCommand: string;
    try {
      startCommand = resolveStartCommand(project, probe, dep.port);
    } catch (e) {
      if (e instanceof StartCommandError) throw new DeployError(e.message);
      throw e;
    }

    // Look before touching anything: a service, folder or port that is not ours,
    // or the same repo already running by hand, stops the deploy here.
    const firstProduction = dep.env === "production" && !(await currentProduction(project.id, dep.id));
    const conflicts = blockingConflicts(
      await probeConflicts(session, {
        unitDir: deps.unitDir,
        slug: project.slug,
        unit: unitInfo.unit,
        port: dep.port,
        repo: project.repoFullName ?? repoNameOf(project.repoUrl),
      }),
      firstProduction
    );
    if (conflicts.length > 0) {
      for (const c of conflicts) log.warn(c.detail);
      throw new DeployError(
        `Nothing was changed on your container. ${conflicts
          .slice(0, 3)
          .map((c) => c.detail)
          .join(" ")}`
      );
    }

    throwIfCanceled(signal);
    // A GitHub release is already built, so the user's own install command plays no part in what the container needs.
    const needs = preflightNeeds(githubBuild ? { runtime: project.runtime, installCommand: null } : project, built.files, built.spec);
    const preflight = deps.preflight ? deps.preflight(session) : sessionPreflight(session);
    // Look at the container before anything is uploaded or created: one fix line, nothing changed.
    await checkContainerReady({ preflight, needs, home, slug: project.slug, log, signal });
    await run(session, log, "Preparing folders", remote.prepareDirs(home, project.slug), 120_000, signal);
    await run(session, log, "Checking the service name", remote.guardUnitFree(deps.unitDir, unitInfo.unit), 120_000, signal);

    // Install and build in the new release folder, under a cap, while the running app keeps serving.
    // From here a failure, or a cancel, can leave the folder behind, so the catch block removes it.
    releaseBuilt = true;
    await runContainerBuild({
      session,
      log,
      serverId: server.id,
      deploymentId,
      home,
      slug: project.slug,
      releaseId: dep.releaseId,
      built,
      env,
      memoryMb: server.buildMemoryMb,
      cpuCores: Math.min(server.buildCpuQuarters / 4, buildCpuRange(probe.cpus ?? reportedCpus(server.probe)).max),
      containerMemoryMb: probe.memTotalMb ?? reportedMemoryMb(server.probe),
      appRunning: Boolean(await currentProduction(project.id, dep.id)),
      needs,
      preflight,
      signal,
      lockPollMs: deps.lockPollMs,
      artifact: githubBuild ? "the release built on GitHub" : undefined,
      recordStage,
      cache: npmCachePlan({ enabled: project.buildCacheEnabled, env: dep.env, lockHash: "npmLockHash" in built ? built.npmLockHash ?? null : null, buildInstall: built.spec.buildInstall, remoteInstall: built.spec.remoteInstall }),
      npmLockHash: "npmLockHash" in built ? built.npmLockHash ?? null : null,
    });
    throwIfCanceled(signal);
    if (!(await setState(deploymentId, "deploying"))) {
      // Canceled while the build ran: nothing was switched, so remove the release folder it made.
      await session
        .script(discardBuildScript({ home, slug: project.slug, releaseId: dep.releaseId }), { timeoutMs: 60_000 })
        .catch(() => {});
      throw new DeployError("The deployment was canceled.");
    }

    await session.writeFile(envFileOf(home, project.slug, dep.releaseId), renderEnvFile(env), "600", { signal });

    const venv =
      project.runtime === "python" && built.files.hasRequirements
        ? `${unitInfo.workDir}/.venv/bin`
        : undefined;
    const unitFile = remote.unitFile({
        slug: project.slug,
        description: `Egg: ${project.name}${dep.env === "preview" ? ` (preview ${dep.releaseId.slice(0, 8)})` : ""}`,
        workDir: unitInfo.workDir,
        envFile: unitInfo.envFile,
        port: dep.port,
        startCommand,
        pathPrefix: venv,
      });
    if (dep.env === "production") {
      const currentUnit = await session.exec(`cat ${shellQuote(`${deps.unitDir}/${unitInfo.unit}`)}`);
      previousUnitFile = currentUnit.code === 0 ? currentUnit.stdout : null;
      nextProductionUnitFile = unitFile;
    }
    if (dep.env === "preview") {
      await session.writeFile(`${deps.unitDir}/${unitInfo.unit}`, unitFile, "644", { signal });
      previewUnitWritten = true;
      await run(session, log, "Registering the service", remote.installUnit(deps.unitDir, unitInfo.unit), 120_000, signal);
      throwIfCanceled(signal);
    }

    // ---- switch over, with automatic revert
    const previous = dep.env === "production" ? await currentProduction(project.id, dep.id) : null;
    throwIfCanceled(signal);
    if (!(await beginActivation(deploymentId))) throw new DeployError("The deployment was canceled before activation.");

    await measureStage("activation", async () => {
    if (dep.env === "production") {
      await session!.writeFile(`${deps.unitDir}/${unitInfo.unit}`, unitFile, "644");
      productionUnitWritten = true;
      await run(session!, log, "Registering the service", remote.installUnit(deps.unitDir, unitInfo.unit));
      await run(
        session!,
        log,
        "Switching the release",
        remote.activateProduction({
          home,
          slug: project.slug,
          releaseId: dep.releaseId,
          unit: unitInfo.unit,
          unitDir: deps.unitDir,
          restoreUnitFile: previousUnitFile,
        })
      );
      productionActivated = true;
    } else {
      await run(session!, log, "Starting the preview", remote.startUnit(unitInfo.unit));
    }
    }, recordStage);

    log.info(`Waiting for the app to answer on port ${dep.port}`);
    const ok = await measureStage("health", () => healthy(
      session!,
      log,
      unitInfo.unit,
      dep.port,
      project.healthPath,
      deps.healthTimeoutSeconds
    ), recordStage, null, Boolean).catch((err: unknown) => {
      // A dropped SSH link during the check is treated like an unhealthy app, so the revert below still runs.
      log.error(`The health check failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    });

    if (!ok) {
      await logJournal(session, log, unitInfo.unit);
      if (dep.env === "production" && previous) {
        log.warn("Reverting to the previous release");
        await run(
          session,
          log,
          "Reverting",
          remote.activateProduction({
            home,
            slug: project.slug,
            releaseId: previous.releaseId,
            unit: unitInfo.unit,
            unitDir: deps.unitDir,
            unitFile: previousUnitFile,
            restoreUnitFile: nextProductionUnitFile,
          })
        ).catch((e) => log.error(String(e.message ?? e)));
        const back = await healthy(session, log, unitInfo.unit, previous.port, project.healthPath, 20);
        log.info(
          back
            ? "The previous release is serving traffic again."
            : "The previous release did not come back either. Check the logs."
        );
      }
      throw new DeployError(
        `The new release did not become healthy on port ${dep.port}. Make sure your app listens on the PORT environment variable and on 0.0.0.0.`
      );
    }

    // ---- success
    if (dep.env === "production") await markCurrent(project.id, dep.id);
    log.info(
      dep.env === "production"
        ? `Live on port ${dep.port}. Map your domain to this port in the Nest dashboard.`
        : `Preview is running on port ${dep.port}. Map a domain to it in the Nest dashboard to open it.`
    );
    // Mark ready first so this release counts when old ones are cleaned up.
    // The release is already live, so a cancel that arrived after the switch cannot undo it.
    const finished = await setState(deploymentId, "ready", { finishedAt: new Date() }, dep.env === "production");
    if (!finished) throw new DeployError("The pull request closed while its preview was starting.");
    await cleanup(session, log, project, home, deps.unitDir, dep.env === "production" ? dep.releaseId : (previous?.releaseId ?? null));
    await log.flush();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(message);
    await log.flush().catch(() => {});
    const canceled = (await stateOf(deploymentId)) === "canceled";
    // A built release that was never switched on is a folder nothing serves: remove it, or it fills the disk
    // and blocks every later deploy's space check. A live release is never touched here.
    if (releaseBuilt && session && !productionActivated && !previewUnitWritten) {
      const home = (await getProbe(session, server).catch(() => null))?.home;
      if (home) {
        await session
          .script(discardBuildScript({ home, slug: project.slug, releaseId: dep.releaseId }), { timeoutMs: 60_000 })
          .catch(() => {});
      }
    }
    if (previewUnitWritten && session) {
      // A preview that did not come up must not stay behind as an enabled, restarting service.
      const home = (await getProbe(session, server).catch(() => null))?.home;
      if (home) {
        const removed = await session
          .script(
            remote.removePreview({
              home,
              slug: project.slug,
              releaseId: dep.releaseId,
              unit: unitName(project.slug, { releaseId: dep.releaseId }),
              unitDir: deps.unitDir,
            }),
            { timeoutMs: 60_000 }
          )
          .then((result) => result.code === 0)
          .catch(() => false);
        if (removed) {
          await db.update(schema.deployments).set({ cleanedUp: true }).where(eq(schema.deployments.id, deploymentId));
        }
      }
    }
    if (dep.env === "production" && productionUnitWritten && !productionActivated && session) {
      if (productionUnitName) {
        await session.script(remote.restoreUnit(deps.unitDir, productionUnitName, previousUnitFile), { timeoutMs: 30_000 }).catch(() => {});
      }
    }
    await setState(deploymentId, canceled ? "canceled" : "error", {
      error: log.mask(message).slice(0, 500),
      finishedAt: new Date(),
    });
    if (!(err instanceof DeployError) && !(err instanceof ContainerBuildError) && !(err instanceof BuildLockError) && !(err instanceof GithubBuildError) && !canceled) {
      // Unexpected failures are still reported to the user, but also logged.
      console.error(`Deployment ${deploymentId} failed`, err);
    }
  } finally {
    session?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    if (ownsUpload) discardUpload(deploymentId);
    await log.flush().catch(() => {});
  }
}

/** Switch production back to an earlier release that is still on the server. */
export async function runRollbackJob(
  deploymentId: string,
  deps: PipelineDeps = defaultDeps(),
  signal: AbortSignal = new AbortController().signal
): Promise<void> {
  const { dep, project, server } = await load(deploymentId);
  const log = new DeploymentLogger(deploymentId);
  let session: NestSession | null = null;

  try {
    if ((await stateOf(deploymentId)) !== "queued") return;
    if (dep.triggeredBy && dep.triggeredBy !== project.userId && await getProjectRole(dep.triggeredBy, project.id) !== "developer") {
      throw new DeployError("The deployment actor no longer has permission to deploy this project.");
    }
    if (!(await setState(deploymentId, "deploying", { startedAt: new Date() }))) return;
    throwIfCanceled(signal);
    log.info(`Rolling ${project.name} back to release ${dep.releaseId.slice(0, 8)}`);

    session = await deps.connect(server);
    throwIfCanceled(signal);
    const probe = await getProbe(session, server);
    const home = probe.home;
    const unit = unitName(project.slug);
    const previous = await currentProduction(project.id, dep.id);

    throwIfCanceled(signal);
    const exists = await session.exec(
      `test -d ${shellQuote(releaseDir(home, project.slug, dep.releaseId))}`,
      { signal }
    );
    if (exists.code !== 0) {
      throw new DeployError(
        "That release is no longer on your server (old releases are removed to save disk space)."
      );
    }

    throwIfCanceled(signal);
    const oldUnit = await session.exec(`cat ${shellQuote(`${deps.unitDir}/${unit}`)}`);
    const previousUnitFile = oldUnit.code === 0 ? oldUnit.stdout : null;
    throwIfCanceled(signal);
    if (!(await beginActivation(deploymentId))) throw new DeployError("The rollback was canceled before activation.");
    await run(
      session,
      log,
      "Switching the release",
      remote.activateProduction({
        home,
        slug: project.slug,
        releaseId: dep.releaseId,
        unit,
        unitDir: deps.unitDir,
        restoreUnitFile: previousUnitFile,
      })
    );
    const ok = await healthy(session, log, unit, dep.port, project.healthPath, deps.healthTimeoutSeconds);
    if (!ok) {
      await logJournal(session, log, unit);
      if (previous) {
        log.warn("Restoring the release that was live before");
        await run(
          session,
          log,
          "Restoring",
          remote.activateProduction({
            home,
            slug: project.slug,
            releaseId: previous.releaseId,
            unit,
            unitDir: deps.unitDir,
            restoreUnitFile: previousUnitFile,
          })
        ).catch((e) => log.error(String(e.message ?? e)));
      }
      throw new DeployError("The older release did not become healthy, so nothing was changed.");
    }

    // Once switched and healthy, cancellation is too late to undo production.
    await markCurrent(project.id, dep.id);
    log.info("Rollback complete. Database changes are not reversed.");
    await log.flush();
    await setState(deploymentId, "ready", { finishedAt: new Date() }, true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(message);
    await log.flush().catch(() => {});
    const canceled = (await stateOf(deploymentId)) === "canceled";
    await setState(deploymentId, canceled ? "canceled" : "error", { error: message.slice(0, 500), finishedAt: new Date() });
    if (!(err instanceof DeployError)) console.error(`Rollback ${deploymentId} failed`, err);
  } finally {
    session?.close();
    await log.flush().catch(() => {});
  }
}

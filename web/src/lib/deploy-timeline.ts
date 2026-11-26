/**
 * The timeline of one deployment, worked out from what the pipeline already records: the
 * deployment row (state and timestamps), the stage measurements it writes (performance.ts) and
 * its log lines. Nothing here reads the database or changes anything, so it runs the same on the
 * server and in the browser.
 *
 * What the records can and cannot say:
 * - A stage measurement is written when the stage ends, so a stage that is running right now has
 *   none. The current stage is worked out from the state and from marker lines in the log.
 * - "Preparing" covers cloning and packing, connecting, the container check, the upload, waiting
 *   for another build and unpacking. They are measured separately, but the timeline shows them as
 *   one stage with a detail line.
 * - "Building" is the install and build on the container. A project without a build step skips it.
 * - A rollback has no clone or build: it shows queued, switching, health check, live.
 * - The log is capped at 20,000 lines. If a marker line was dropped, the stage still follows from
 *   the state and the measurements, but its time and detail may be missing.
 */

export type TimelineStageKey = "queued" | "preparing" | "building" | "starting" | "health" | "reverted" | "live";
export type TimelineStatus = "done" | "current" | "failed" | "canceled" | "skipped" | "pending";
export type TimelineOutcome = "running" | "live" | "failed" | "canceled";

type When = Date | string | number | null | undefined;

export type TimelineDeployment = {
  state: string;
  source: string;
  env: "production" | "preview";
  port: number;
  error: string | null;
  createdAt: When;
  startedAt: When;
  activationStartedAt: When;
  finishedAt: When;
};

/** One row of `deploy_stage_metrics`. */
export type TimelineMetric = {
  stage: string;
  startedAt: When;
  finishedAt: When;
  durationMs: number;
  outcome: "ok" | "failed" | "unknown";
};

export type TimelineLog = { at: When; level: string; message: string };

export type TimelineStage = {
  key: TimelineStageKey;
  label: string;
  status: TimelineStatus;
  /** When the stage was reached (ISO), or null when the records do not say. */
  at: string | null;
  /** How long it took, in ms, once it is over. */
  durationMs: number | null;
  /** One short line: what a running stage is doing, why one was skipped, what a finished one found. */
  detail: string | null;
};

export type TimelineFailure = {
  stage: TimelineStageKey;
  /** What went wrong and what to do about it. */
  message: string;
  /** True when the message came from the table below; false for the neutral fallback. */
  known: boolean;
  /** A second fact worth a line of its own, for example that the app is still running. */
  note: string | null;
  /** What Egg recorded, unchanged. */
  recorded: string | null;
};

export type Timeline = {
  stages: TimelineStage[];
  outcome: TimelineOutcome;
  failure: TimelineFailure | null;
  /** Set when a canceled deployment recorded why. */
  canceledWhy: string | null;
  /** The text for a polite live region. It changes only when the stage changes. */
  summary: string;
};

// ----------------------------------------------------------------- helpers

function ms(v: When): number | null {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

/** "800ms" is shown as "under 1s"; otherwise "12s" or "1m 5s", the way the deployment duration is written. */
export function formatStageDuration(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  if (value < 1000) return "under 1s";
  const s = Math.round(value / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// ----------------------------------------------------------------- the failure sentence

const APP_STILL_RUNNING = " Your app is still running.";

type LogView = { at: number | null; level: string; message: string };

function toLogs(logs: TimelineLog[]): LogView[] {
  return logs.map((l) => ({ at: ms(l.at), level: l.level, message: l.message.trim() }));
}

function findLog(logs: LogView[], re: RegExp): LogView | undefined {
  return logs.find((l) => re.test(l.message));
}

function findLastLog(logs: LogView[], re: RegExp): LogView | undefined {
  for (let i = logs.length - 1; i >= 0; i--) if (re.test(logs[i].message)) return logs[i];
  return undefined;
}

const MARK = {
  noBuild: /^No build step for this project\.$/,
  buildStart: /^Building on your container, capped at /,
  waitHealth: /^Waiting for the app to answer on port \d+$/,
  reverting: /^Reverting to the previous release$/,
  restored: /^The previous release is serving traffic again\.$/,
  notRestored: /^The previous release did not come back either\./,
  healthy: /^Healthy: /,
  crashed: /^Service crashed on start$/,
  noAnswer: /^No healthy response on port (\d+) after (\d+)s$/,
  buildStep: /^(Installing|Building|Installing production dependencies): (.+)$/,
} as const;

type Rule = {
  test: RegExp;
  say: (m: RegExpExecArray, ctx: { logs: LogView[]; port: number }) => string;
  /** The stage this failure belongs to, when the message alone settles it. */
  stage?: TimelineStageKey;
};

/** The messages that are already a fix line: shown as they are. */
const AS_WRITTEN: RegExp[] = [
  /^Egg could not check your container before building/,
  /^Free up disk space on your container/,
  /^Builds on your container run under a memory cap/,
  /^Your container cannot apply a memory cap/,
  /^Install (Node\.js|npm|Python 3|python3-venv|coreutils)/,
  /^Node\.js .* on your container does not match/,
  /^This project uses (pnpm|yarn), which needs corepack/,
  /^Set a start command for this project/,
  /^Nothing was changed on your container\./,
];

function buildStepOf(logs: LogView[]): { kind: string; command: string } | null {
  const hit = findLastLog(logs, MARK.buildStep);
  const m = hit ? MARK.buildStep.exec(hit.message) : null;
  if (!m) return null;
  const kind = m[1] === "Installing" ? "install" : m[1] === "Building" ? "build" : "production install";
  return { kind, command: clip(m[2], 60) };
}

/**
 * Every failure message the pipeline writes (pipeline.ts, build.ts, container-build.ts,
 * container-probe.ts, build-lock.ts, builds/uploads.ts, runtime.ts and the ssh layer), in the
 * order they are tried. Each says what went wrong and what to do about it.
 */
const RULES: Rule[] = [
  // Getting the source
  {
    test: /^Could not clone the repository/,
    say: () => "Egg could not clone your repository. Check the production branch in Settings and, for a private repository, that the GitHub app is installed on it.",
  },
  {
    test: /^The root directory "(.*)" does not exist in this repository/,
    say: (m) => `The root directory "${clip(m[1], 60)}" is not in your repository. Fix Root directory in Settings, then deploy again.`,
  },
  {
    test: /^(Could not (build|fetch|verify) .*commit|The requested commit checkout failed)/,
    say: () => "Egg could not get the exact commit this deployment asked for, so it did not build the branch tip instead. Check that the commit is still on GitHub, then deploy again.",
  },
  {
    test: /^The repository is larger than (\d+) MB/,
    say: (m) => `Your repository is larger than ${m[1]} MB, so Egg did not clone it. Remove large files from it, then deploy again.`,
  },
  {
    test: /^Egg's disk is nearly full/,
    say: () => "Egg's own disk is nearly full, so your repository was not cloned. Nothing is wrong with your project; wait a little, then deploy again.",
  },
  {
    test: /compressed source archive exceeds|source entries\.|byte unpacked source limit|could not be packaged safely/,
    say: () => "Your source is too large to send to the container. Leave out files the app does not need to run, such as build output or data, then deploy again.",
  },
  {
    test: /^The build timed out\.$/,
    say: () => "Cloning your repository took longer than 5 minutes and was stopped. Deploy again, and make the repository smaller if it keeps happening.",
  },
  {
    test: /^Repositories on .* are not supported|^Only plain https repository URLs|^The repository URL is not valid/,
    say: () => "Egg can only deploy repositories on github.com. Check the repository in Settings.",
  },
  { test: /^The branch name is not valid/, say: () => "The branch name is not valid. Check the production branch in Settings." },
  { test: /^The commit hash is not valid/, say: () => "The commit this deployment asked for is not valid. Deploy the branch again." },
  {
    test: /^Could not start (git|tar)/,
    say: () => "Egg could not run git on its own machine. Deploy again; if it keeps happening, tell the person who runs Egg.",
  },
  { test: /^The build was canceled\.$/, say: () => "The deployment was stopped while it was cloning. Deploy again if you still want it." },

  // GitHub builds
  {
    test: /^GitHub did not send the build in time/,
    say: () => "GitHub did not send the build in time. Open the workflow run on GitHub, fix what failed, then deploy again.",
  },
  {
    test: /^The build GitHub sent (could not be read|did not match its checksum)/,
    say: () => "The build GitHub sent was damaged on the way. Run the workflow again.",
  },
  {
    test: /^The build from GitHub was refused\./,
    say: () => "Egg refused the build GitHub sent. Read the reason in the log, fix what the workflow uploads, then run it again.",
  },

  // Talking to the container
  {
    test: /^Timed out connecting to Nest/,
    say: () => "Egg could not reach your Nest container in time. Check that it is running, then deploy again.",
  },
  {
    test: /^Could not reach the Nest SSH host/,
    say: () => "Egg could not reach the Nest SSH host. Wait a minute, then deploy again.",
  },
  {
    test: /^Confirm host key/,
    say: () => "Your server's host key is not confirmed yet. Open the Connect page, check the fingerprint and confirm it, then deploy again.",
  },
  {
    test: /^The host key of .* changed/,
    say: () => "The server's host key changed, so nothing was sent to it. If you expected this, reconnect the server, then deploy again.",
  },
  {
    test: /^SSH error:/,
    say: () => "Egg hit an SSH error while talking to your container. Check that the container is running, then deploy again.",
  },

  // The build
  {
    test: /^The build needed more memory than the cap of (\d+) MB/,
    say: (m) => `The build ran out of memory at its cap of ${m[1]} MB. Raise Build memory on the Container page or use less memory in the build, then deploy again.`,
  },
  {
    test: /^The build took longer than (\d+) minutes/,
    say: (m) => `The build ran for more than ${m[1]} minutes and was stopped. Make the build faster, then deploy again.`,
  },
  {
    test: /^The build stopped because the container's free disk space fell below (\d+) MB/,
    say: (m) => `The build stopped because your container had under ${m[1]} MB of disk space free. Free up disk space on the container, then deploy again.`,
  },
  {
    test: /^The build used more than (\d+) MB of disk space/,
    say: (m) => `The build used more than ${m[1]} MB of disk and was stopped. Make it write less, for example by leaving out large caches, then deploy again.`,
  },
  {
    test: /^The output folder "(.*)" was not created by the build/,
    say: (m) => `The build did not create the output folder "${clip(m[1], 60)}". Set Output directory in Settings to the folder your build writes.`,
  },
  {
    test: /^The output folder "(.*)" must be inside the project/,
    say: (m) => `The output folder "${clip(m[1], 60)}" must be inside your project. Fix Output directory in Settings, then deploy again.`,
  },
  {
    test: /^The upload was corrupted \(checksum mismatch\)/,
    say: () => "The upload to your container was damaged on the way. Deploy again.",
  },
  {
    test: /^Your container has no sha256sum/,
    say: () => "Your container has no sha256sum command, so the upload could not be checked. Install coreutils on it, then deploy again.",
  },
  {
    test: /^The source could not be unpacked within the safe disk budget/,
    say: () => "The source is too big to unpack safely on your container. Free up disk space on it or send less, then deploy again.",
  },
  {
    test: /^The source could not be unpacked on your container \(exit (\d+)\)/,
    say: (m) => `Your container could not unpack the source (exit ${m[1]}). Check its free disk space, then deploy again.`,
  },
  {
    test: /^The build did not start: your container reports (\d+) MB of memory/,
    say: (m) => `Your container reports ${m[1]} MB of memory, which leaves too little to build in after the 512 MB kept for your app. Use a larger container.`,
  },
  {
    test: /^The build failed \(exit (\d+)\)/,
    say: (m, ctx) => {
      const step = buildStepOf(ctx.logs);
      const what = step ? `Your ${step.kind} command "${step.command}"` : "Your install or build command";
      return `${what} failed with exit code ${m[1]}. Read the last error lines in the build output, fix them, then deploy again.`;
    },
  },

  // Waiting for the container's build slot
  {
    test: /^Another build has been running on this container for more than 30 minutes/,
    say: () => "Another build has held this container for more than 30 minutes. Cancel it or wait for it to finish, then deploy again.",
  },
  {
    test: /^A previous build (lock expired|on this container stopped reporting in)/,
    say: () => "An earlier build on this container stopped reporting in and Egg could not confirm it has stopped. Check that nothing named egg-build is running there, then deploy again.",
  },
  {
    test: /^This build stopped reporting in for too long/,
    say: () => "This build stopped reporting in, so another deployment took over the container's build slot. Deploy again.",
  },
  {
    test: /^An operator recovery guard is present/,
    say: () => "Builds on this container are paused until the person who runs Egg clears a recovery guard.",
  },

  // Looking at the container before changing it
  { test: /^Static sites need Python 3 or Node\.js/, say: () => "Static sites need Python 3 or Node.js on your container to be served. Install one of them, then deploy again." },

  // Going live
  {
    test: /did not become healthy on port (\d+)/,
    stage: "health",
    say: (m, ctx) => {
      const port = Number(m[1]) || ctx.port;
      if (findLog(ctx.logs, MARK.crashed)) {
        return `Your app crashed as soon as it started on port ${port}. Read the app's last log lines in the log, fix the error it prints, then deploy again.`;
      }
      const none = findLastLog(ctx.logs, MARK.noAnswer);
      const t = none ? MARK.noAnswer.exec(none.message) : null;
      if (t) {
        return `Your app did not answer on port ${port} within ${t[2]} seconds. Make it listen on the PORT environment variable and on 0.0.0.0.`;
      }
      return `Your app did not become healthy on port ${port}. Make it listen on the PORT environment variable and on 0.0.0.0.`;
    },
  },
  {
    test: /^The older release did not become healthy/,
    stage: "health",
    say: () => "The older release did not start answering health checks. Redeploy from your branch instead of rolling back.",
  },
  {
    test: /^That release is no longer on your server/,
    say: () => "That release was removed from your server to save disk space. Redeploy from your branch instead.",
  },
  {
    test: /^(Preparing folders|Checking the service name|Registering the service|Switching the release|Starting the preview|Reverting|Restoring) failed \(exit (\d+)\)/,
    say: (m) => `Egg could not finish "${m[1].toLowerCase()}" on your container (exit ${m[2]}). Read the lines above it in the log, then deploy again.`,
  },
  {
    test: /^The pull request closed while its preview was starting/,
    say: () => "The pull request was closed while its preview was starting, so the preview was stopped. Reopen the pull request to get a preview again.",
  },

  // Who may deploy, and what stopped a deployment from outside
  {
    test: /^The deployment actor no longer has permission/,
    say: () => "The person who started this deployment no longer has access to the project. Deploy again from an account that does.",
  },
  {
    test: /^The operator recovered an interrupted build/,
    say: () => "This build was interrupted when Egg stopped, and the person who runs Egg cleared it. Deploy again.",
  },
  {
    test: /^Import did not complete/,
    say: () => "The import did not finish, and your original service was left running or put back. Check the import page, then try again.",
  },
];

function stripTail(error: string): { text: string; appRunning: boolean } {
  const appRunning = error.includes(APP_STILL_RUNNING.trim());
  return { text: error.replace(APP_STILL_RUNNING, "").trim(), appRunning };
}

/**
 * Turn what a failed deployment recorded into what went wrong and what to do. A message the
 * pipeline writes is matched by its start, so a changed number still matches. Anything else gets a
 * neutral sentence that points at the log.
 */
export function explainFailure(input: {
  error: string | null;
  logs?: TimelineLog[];
  port?: number;
  stage?: TimelineStageKey;
}): TimelineFailure {
  const logs = toLogs(input.logs ?? []);
  const recorded = input.error?.trim() || null;
  const stage = input.stage ?? "preparing";
  const neutral = "Egg could not finish this deployment. Read the last lines of the log below to see why, then deploy again.";
  if (!recorded) return { stage, message: neutral, known: false, note: null, recorded: null };

  const { text, appRunning } = stripTail(recorded);
  const note = appRunning ? "Your app is still running the release it had before." : null;
  const reverted = revertOutcome(logs);
  const revertNote = reverted === "restored" ? "The previous release is serving traffic again." : reverted === "failed" ? "The previous release did not come back either. Check the log." : null;

  for (const rule of RULES) {
    const m = rule.test.exec(text);
    if (!m) continue;
    return {
      stage: rule.stage ?? stage,
      message: rule.say(m, { logs, port: input.port ?? 0 }),
      known: true,
      note: revertNote ?? note,
      recorded,
    };
  }
  if (AS_WRITTEN.some((re) => re.test(text))) {
    return { stage, message: clip(text, 320), known: true, note: revertNote ?? note, recorded };
  }
  return { stage, message: neutral, known: false, note: revertNote ?? note, recorded };
}

function revertOutcome(logs: LogView[]): "restored" | "failed" | "unknown" | null {
  if (!findLog(logs, MARK.reverting)) return null;
  if (findLog(logs, MARK.restored)) return "restored";
  if (findLog(logs, MARK.notRestored)) return "failed";
  return "unknown";
}

/** Why a deployment was canceled, from the reason it recorded. */
export function explainCancel(error: string | null): string {
  const why = error?.trim() ?? "";
  if (/pull request closed/i.test(why)) return "Canceled because the pull request was closed.";
  if (/project role revoked/i.test(why)) return "Canceled because the person who started it lost access to the project.";
  if (/canceled for cleanup/i.test(why)) return "Canceled while Egg cleaned up.";
  return "This deployment was canceled.";
}

// ----------------------------------------------------------------- the stages

const ACTIVE = new Set(["queued", "building", "deploying"]);

const LABELS: Record<TimelineStageKey, string> = {
  queued: "Queued",
  preparing: "Preparing",
  building: "Building",
  starting: "Starting",
  health: "Health check",
  reverted: "Reverted",
  live: "Live",
};

const lastMetric = (metrics: TimelineMetric[], stage: string) => {
  for (let i = metrics.length - 1; i >= 0; i--) if (metrics[i].stage === stage) return metrics[i];
  return undefined;
};

/** What the preparing stage is doing, from the newest marker line in the log. */
function preparingDetail(logs: LogView[]): string | null {
  const marks: Array<[RegExp, string]> = [
    [/^Another build is running on this container/, "Waiting for another build on this container to finish"],
    [/^(Checksum verified|Unpacked the source)$/, "Unpacking the source on your container"],
    [/^Uploading /, "Uploading the source to your container"],
    [/^Waiting for GitHub to send/, "Waiting for GitHub to send the build"],
    [/^The build from GitHub arrived/, "The build from GitHub arrived"],
    [/^(Commit [0-9a-f]{7}:|Packed source:)/, "Packing the source"],
    [/^Connecting to your Nest container$/, "Connecting to your container"],
    [/^Deploying /, "Cloning your repository"],
  ];
  for (let i = logs.length - 1; i >= 0; i--) {
    for (const [re, text] of marks) if (re.test(logs[i].message)) return text;
  }
  return null;
}

function buildingDetail(logs: LogView[]): string | null {
  const step = buildStepOf(logs);
  if (!step) return null;
  return step.kind === "install" ? `Installing: ${step.command}` : step.kind === "build" ? `Building: ${step.command}` : `Installing production dependencies: ${step.command}`;
}

/**
 * The stages of one deployment, in order, with a status and the time each was reached. Pure: the
 * same records always give the same answer.
 */
export function buildTimeline(dep: TimelineDeployment, metricsIn: TimelineMetric[] = [], logsIn: TimelineLog[] = []): Timeline {
  const logs = toLogs(logsIn);
  const metrics = metricsIn;
  const rollback = dep.source === "rollback";
  const active = ACTIVE.has(dep.state);
  const ready = dep.state === "ready";
  const canceled = dep.state === "canceled";
  const failedState = !active && !ready && !canceled;

  const createdAt = ms(dep.createdAt);
  const startedAt = ms(dep.startedAt);
  const activationAt = ms(dep.activationStartedAt);
  const finishedAt = ms(dep.finishedAt);

  // Which stage the deployment got to, as an index into `order`.
  const order: TimelineStageKey[] = rollback ? ["queued", "starting", "health", "live"] : ["queued", "preparing", "building", "starting", "health", "live"];
  const at = (k: TimelineStageKey) => order.indexOf(k);

  const buildMetric = lastMetric(metrics, "build");
  const unpackMetric = lastMetric(metrics, "unpack");
  const activationMetric = lastMetric(metrics, "activation");
  const healthMetric = lastMetric(metrics, "health");
  const noBuild = !rollback && Boolean(findLog(logs, MARK.noBuild)) && !buildMetric;
  const buildLog = findLog(logs, MARK.buildStart);
  const waitHealthLog = findLog(logs, MARK.waitHealth);
  const revertLog = rollback ? undefined : findLog(logs, MARK.reverting);
  const failureHint = failedState || canceled ? explainFailure({ error: dep.error, logs: logsIn, port: dep.port }) : null;

  let reached = 0;
  // A deployment that ended before it ever started (startedAt unset) failed while still queued.
  if (startedAt !== null || (active && dep.state !== "queued")) reached = 1;
  if (rollback) {
    if (dep.state === "deploying" || activationAt !== null || ready) reached = Math.max(reached, at("starting"));
    if (healthMetric || findLog(logs, MARK.healthy) || findLog(logs, MARK.crashed) || findLog(logs, MARK.noAnswer)) reached = Math.max(reached, at("health"));
    if (failedState && failureHint?.stage === "health") reached = at("health");
  } else {
    if (buildMetric || buildLog) reached = Math.max(reached, at("building"));
    if (
      dep.state === "deploying" ||
      ready ||
      activationAt !== null ||
      activationMetric ||
      buildMetric?.outcome === "ok" ||
      (noBuild && unpackMetric?.outcome === "ok")
    ) {
      reached = Math.max(reached, at("starting"));
    }
    if (healthMetric || waitHealthLog || revertLog) reached = Math.max(reached, at("health"));
    if (failureHint?.stage === "health") reached = Math.max(reached, at("health"));
  }
  if (ready) reached = at("live");

  // When each stage was reached.
  const when: Partial<Record<TimelineStageKey, number | null>> = { queued: createdAt, live: ready ? finishedAt : null };
  if (rollback) {
    when.starting = activationAt ?? startedAt;
    when.health = null;
  } else {
    when.preparing = startedAt;
    when.building = ms(buildMetric?.startedAt) ?? buildLog?.at ?? null;
    when.starting = activationAt ?? ms(activationMetric?.startedAt) ?? (noBuild ? ms(unpackMetric?.finishedAt) : ms(buildMetric?.finishedAt)) ?? null;
    when.health = ms(healthMetric?.startedAt) ?? waitHealthLog?.at ?? null;
  }

  const reverted = revertOutcome(logs);
  const healthFailed = !rollback && (healthMetric?.outcome === "failed" || Boolean(revertLog));

  const stages: TimelineStage[] = order.map((key, i) => {
    let status: TimelineStatus;
    if (key === "building" && noBuild) status = "skipped";
    else if (ready) status = "done";
    else if (active) status = i < reached ? "done" : i === reached ? "current" : "pending";
    else status = i < reached ? "done" : i === reached ? (canceled ? "canceled" : "failed") : "skipped";
    if (healthFailed && key === "health") status = "failed";
    if (key === "live" && !ready && !active) status = "skipped";

    let detail: string | null = null;
    if (key === "building" && noBuild) detail = "No build step for this project";
    else if (status === "current") {
      if (key === "queued") detail = "Waiting for a free slot in the queue";
      else if (key === "preparing") detail = preparingDetail(logs) ?? "Getting the source ready";
      else if (key === "building") detail = buildingDetail(logs) ?? "Installing and building on your container";
      else if (key === "starting") detail = rollback ? "Switching to the older release, then waiting for it to answer" : dep.env === "preview" ? "Starting the preview" : "Switching to the new release";
      else if (key === "health") detail = `Waiting for the app to answer on port ${dep.port}`;
    } else if (status === "done" && key === "health") {
      detail = findLastLog(logs, MARK.healthy)?.message.replace(/^Healthy: /, "") ?? null;
    } else if (status === "skipped" && !(key === "building" && noBuild)) {
      detail = "Not reached";
    }
    return {
      key,
      label: key === "starting" && rollback ? "Switching release" : key === "live" && dep.env === "preview" ? "Running" : LABELS[key],
      status,
      // A stage that did not run has no time, even if a later boundary could be read off the records.
      at: status === "skipped" || status === "pending" ? null : iso(when[key] ?? null),
      durationMs: null,
      detail,
    };
  });

  // A revert is its own row, straight after the health check that caused it.
  if (revertLog) {
    const restored = reverted === "restored";
    const row: TimelineStage = {
      key: "reverted",
      label: LABELS.reverted,
      status: restored ? "done" : active && reverted === "unknown" ? "current" : "failed",
      at: iso(revertLog.at),
      durationMs: null,
      detail: restored
        ? "The previous release is serving traffic again"
        : active && reverted === "unknown"
          ? "Putting the previous release back"
          : "Could not confirm that the previous release is serving traffic. Check the log",
    };
    stages.splice(stages.findIndex((s) => s.key === "health") + 1, 0, row);
  }

  // How long each stage took: the time to the next stage that has a time, or the measurement.
  const times = stages.map((s) => ms(s.at));
  stages.forEach((s, i) => {
    if (s.status === "skipped" || s.status === "pending" || s.status === "current" || s.key === "live" || s.key === "reverted") return;
    const start = times[i];
    if (start === null) return;
    const metric = s.key === "building" ? buildMetric : s.key === "health" ? healthMetric : undefined;
    if (metric && metric.durationMs >= 0 && s.status !== "canceled") {
      s.durationMs = metric.durationMs;
      return;
    }
    let end: number | null = null;
    for (let j = i + 1; j < stages.length; j++) {
      if (stages[j].status === "skipped") continue;
      end = times[j];
      break;
    }
    if (end === null && (s.status === "failed" || s.status === "canceled")) end = finishedAt;
    if (s.key === "queued") end = startedAt ?? end;
    if (end !== null && end >= start) s.durationMs = end - start;
  });

  // The failure, and the line for a polite live region.
  const failedKey = stages.find((s) => s.status === "failed")?.key ?? stages[Math.min(reached, stages.length - 1)].key;
  const failure = failedState ? explainFailure({ error: dep.error, logs: logsIn, port: dep.port, stage: failedKey }) : null;
  const canceledWhy = canceled ? explainCancel(dep.error) : null;
  const currentIndex = stages.findIndex((s) => s.status === "current");

  let outcome: TimelineOutcome = "running";
  let summary: string;
  if (ready) {
    outcome = "live";
    summary = dep.env === "preview" ? "The preview is running." : "The deployment is live.";
  } else if (canceled) {
    outcome = "canceled";
    summary = canceledWhy ?? "This deployment was canceled.";
  } else if (failedState) {
    outcome = "failed";
    const where = stages.find((s) => s.key === failedKey)?.label ?? "an earlier stage";
    summary = `The deployment failed at ${where}. ${failure?.message ?? ""}`.trim();
  } else {
    const row = stages[currentIndex >= 0 ? currentIndex : 0];
    summary = `${row.label}. Step ${(currentIndex >= 0 ? currentIndex : 0) + 1} of ${stages.length}.`;
  }

  return { stages, outcome, failure, canceledWhy, summary };
}

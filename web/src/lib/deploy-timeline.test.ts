import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  explainCancel,
  explainFailure,
  formatStageDuration,
  type TimelineDeployment,
  type TimelineLog,
  type TimelineMetric,
} from "@/lib/deploy-timeline";

const T0 = Date.parse("2026-11-13T10:00:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000);

const base: TimelineDeployment = {
  state: "queued",
  source: "manual",
  env: "production",
  port: 5173,
  error: null,
  createdAt: at(0),
  startedAt: null,
  activationStartedAt: null,
  finishedAt: null,
};

const log = (seconds: number, message: string, level = "info"): TimelineLog => ({ at: at(seconds), level, message });
const metric = (stage: string, from: number, to: number, outcome: "ok" | "failed" = "ok"): TimelineMetric => ({
  stage,
  startedAt: at(from),
  finishedAt: at(to),
  durationMs: (to - from) * 1000,
  outcome,
});

const status = (t: ReturnType<typeof buildTimeline>) => Object.fromEntries(t.stages.map((s) => [s.key, s.status]));

/** The log of a deploy that reached the start of the build. */
const beforeBuild = [
  log(1, "Deploying recipe-api (production) to sam@sam.hackclub.app"),
  log(5, "Commit 837638e: Add pagination"),
  log(6, "Packed source: 1.2 MB"),
  log(7, "Connecting to your Nest container"),
  log(9, "Uploading 1.2 MB of source"),
  log(12, "Unpacked the source"),
  log(12, "Building on your container, capped at 1024 MB of memory and 100% of one core's time, for at most 15 minutes. Your app keeps running."),
  log(13, "Installing: npm ci"),
  log(30, "Building: npm run build"),
];
const preMetrics = [metric("source", 1, 6), metric("upload", 9, 11), metric("lock_wait", 11, 11), metric("unpack", 11, 12)];

describe("worker deployment progress", () => {
  it("uses process readiness instead of a nonexistent HTTP port", () => {
    const t = buildTimeline({ ...base, listenPort: null, state: "deploying", startedAt: at(1), activationStartedAt: at(10) }, [], [log(12, "Checking that the worker stays active")]);
    const readiness = t.stages.find((s) => s.key === "health");
    expect(readiness?.label).toBe("Process check");
    expect(readiness?.status).toBe("current");
    expect(readiness?.detail).toBe("Checking that the worker stays active");
    expect(t.stages.some((s) => s.detail?.includes("port"))).toBe(false);
  });

  it("explains worker failure and restoration without web health instructions", () => {
    const t = buildTimeline({ ...base, workloadKind: "worker", listenPort: null, port: 0, state: "error", startedAt: at(1), finishedAt: at(20), error: "The worker did not stay active. Check its logs and start command." }, [metric("health", 12, 18, "failed")], [log(12, "Checking that the worker stays active"), log(18, "Reverting to the previous release"), log(20, "The previous release is serving traffic again.")]);
    expect(t.failure?.message).toBe("The worker did not stay active. Check its logs and start command, then deploy again.");
    expect(t.failure?.note).toBe("The previous worker release is running again.");
    expect(t.summary).toContain("Process check");
    expect(t.summary).not.toMatch(/port 0|HTTP|0\.0\.0\.0/);
  });

  it("reports a successful worker as running", () => {
    const t = buildTimeline({ ...base, listenPort: null, port: 0, state: "ready", startedAt: at(1), finishedAt: at(20) }, [metric("health", 12, 18)], [log(18, "Worker is active")]);
    expect(t.summary).toBe("The worker is running.");
    expect(t.stages.at(-1)?.label).toBe("Running");
    expect(t.stages.find((s) => s.key === "health")?.detail).toBe("Worker is active");
  });
});

describe("live notes", () => {
  it("says what stays active for a ready worker", () => {
    const t = buildTimeline(
      { ...base, workloadKind: "worker", listenPort: null, port: 0, state: "ready", startedAt: at(1), finishedAt: at(20) },
      [metric("health", 12, 18)],
      [log(18, "Worker is active")]
    );
    expect(t.summary).toBe("The worker is running.");
    expect(t.liveNote).not.toBeNull();
    expect(t.liveNote).toContain("stays active");
  });

  it("has a live note for a ready web deployment too", () => {
    const t = buildTimeline({ ...base, state: "ready", startedAt: at(1), finishedAt: at(70) });
    expect(t.outcome).toBe("live");
    expect(t.liveNote).not.toBeNull();
  });

  it("has no live note while a deployment is still running", () => {
    const t = buildTimeline(base);
    expect(t.outcome).toBe("running");
    expect(t.liveNote).toBeNull();
  });
});

describe("buildTimeline: a successful production deploy", () => {
  const dep: TimelineDeployment = { ...base, state: "ready", startedAt: at(1), activationStartedAt: at(62), finishedAt: at(70) };
  const metrics = [...preMetrics, metric("build", 12, 61), metric("activation", 62, 64), metric("health", 64, 69)];
  const logs = [
    ...beforeBuild,
    log(61, "Build finished"),
    log(64, "Waiting for the app to answer on port 5173"),
    log(69, "Healthy: HTTP 200 on port 5173"),
    log(70, "Live on port 5173. Map your domain to this port in the Nest dashboard."),
  ];
  const t = buildTimeline(dep, metrics, logs);

  it("has every stage done, in order, ending live", () => {
    expect(t.stages.map((s) => s.key)).toEqual(["queued", "preparing", "building", "starting", "health", "live"]);
    expect(t.stages.every((s) => s.status === "done")).toBe(true);
    expect(t.outcome).toBe("live");
    expect(t.failure).toBeNull();
    expect(t.summary).toBe("The deployment is live.");
  });

  it("gives the time each stage was reached and how long it took", () => {
    const by = Object.fromEntries(t.stages.map((s) => [s.key, s]));
    expect(by.queued.at).toBe(at(0).toISOString());
    expect(by.queued.durationMs).toBe(1000);
    expect(by.preparing.at).toBe(at(1).toISOString());
    expect(by.preparing.durationMs).toBe(11_000);
    expect(by.building.at).toBe(at(12).toISOString());
    expect(by.building.durationMs).toBe(49_000);
    expect(by.starting.at).toBe(at(62).toISOString());
    expect(by.health.at).toBe(at(64).toISOString());
    expect(by.health.durationMs).toBe(5000);
    expect(by.health.detail).toBe("HTTP 200 on port 5173");
    expect(by.live.at).toBe(at(70).toISOString());
  });

  it("calls a finished preview Running", () => {
    expect(buildTimeline({ ...dep, env: "preview" }, metrics, logs).stages.at(-1)?.label).toBe("Running");
  });
});

describe("buildTimeline: a deploy that is running", () => {
  it("is queued before a worker takes it", () => {
    const t = buildTimeline(base);
    expect(status(t)).toEqual({ queued: "current", preparing: "pending", building: "pending", starting: "pending", health: "pending", live: "pending" });
    expect(t.outcome).toBe("running");
    expect(t.summary).toBe("Queued. Step 1 of 6.");
  });

  it("is preparing while it clones, and says what it is doing", () => {
    const t = buildTimeline({ ...base, state: "building", startedAt: at(1) }, [], [log(1, "Deploying recipe-api (production) to sam@host")]);
    expect(status(t).queued).toBe("done");
    expect(status(t).preparing).toBe("current");
    expect(t.stages[1].detail).toBe("Cloning your repository");
    expect(t.stages[1].durationMs).toBeNull();
  });

  it("says when it waits for another build on the container", () => {
    const t = buildTimeline(
      { ...base, state: "building", startedAt: at(1) },
      [metric("source", 1, 6), metric("upload", 9, 11)],
      [...beforeBuild.slice(0, 5), log(11, "Another build is running on this container. Waiting for it to finish.")]
    );
    expect(t.stages[1].status).toBe("current");
    expect(t.stages[1].detail).toBe("Waiting for another build on this container to finish");
  });

  it("is building once the build starts, naming the step", () => {
    const t = buildTimeline({ ...base, state: "building", startedAt: at(1) }, preMetrics, beforeBuild);
    expect(status(t).preparing).toBe("done");
    expect(status(t).building).toBe("current");
    expect(t.stages[2].detail).toBe("Building: npm run build");
    expect(t.stages[2].at).toBe(at(12).toISOString());
    expect(t.summary).toBe("Building. Step 3 of 6.");
  });

  it("is starting while the state is deploying, then health checking once it waits for the app", () => {
    const deploying = { ...base, state: "deploying", startedAt: at(1), activationStartedAt: at(62) };
    const metrics = [...preMetrics, metric("build", 12, 61)];
    const starting = buildTimeline(deploying, metrics, [...beforeBuild, log(61, "Build finished")]);
    expect(status(starting).building).toBe("done");
    expect(status(starting).starting).toBe("current");

    const health = buildTimeline(deploying, [...metrics, metric("activation", 62, 64)], [
      ...beforeBuild,
      log(64, "Waiting for the app to answer on port 5173"),
    ]);
    expect(status(health).starting).toBe("done");
    expect(status(health).health).toBe("current");
    expect(health.stages[4].at).toBe(at(64).toISOString());
    expect(health.stages[4].detail).toBe("Waiting for the app to answer on port 5173");
  });

  it("skips the build for a project without a build step", () => {
    const logs = [...beforeBuild.slice(0, 5), log(12, "Unpacked the source"), log(12, "No build step for this project.")];
    const t = buildTimeline(
      { ...base, state: "deploying", startedAt: at(1), activationStartedAt: at(14) },
      [...preMetrics, metric("activation", 14, 15)],
      logs
    );
    expect(status(t).building).toBe("skipped");
    expect(t.stages[2].detail).toBe("No build step for this project");
    expect(status(t).preparing).toBe("done");
    expect(t.stages[1].durationMs).toBe(13_000);
  });
});

describe("buildTimeline: a health check failure with a revert", () => {
  const dep: TimelineDeployment = {
    ...base,
    state: "error",
    startedAt: at(1),
    activationStartedAt: at(62),
    finishedAt: at(130),
    error: "The new release did not become healthy on port 5173. Make sure your app listens on the PORT environment variable and on 0.0.0.0.",
  };
  const metrics = [...preMetrics, metric("build", 12, 61), metric("activation", 62, 64), metric("health", 64, 109, "failed")];
  const logs = [
    ...beforeBuild,
    log(64, "Waiting for the app to answer on port 5173"),
    log(109, "No healthy response on port 5173 after 45s"),
    log(110, "Last log lines from egg-recipe-api.service:", "warn"),
    log(111, "Reverting to the previous release", "warn"),
    log(125, "The previous release is serving traffic again."),
  ];
  const t = buildTimeline(dep, metrics, logs);

  it("fails at the health check and shows the revert", () => {
    expect(t.stages.map((s) => s.key)).toEqual(["queued", "preparing", "building", "starting", "health", "reverted", "live"]);
    expect(status(t)).toEqual({ queued: "done", preparing: "done", building: "done", starting: "done", health: "failed", reverted: "done", live: "skipped" });
    expect(t.outcome).toBe("failed");
    expect(t.stages[4].durationMs).toBe(45_000);
    expect(t.stages[5].at).toBe(at(111).toISOString());
  });

  it("says what went wrong and what to do, in the words of the real check", () => {
    expect(t.failure?.message).toBe(
      "Your app did not answer on port 5173 within 45 seconds. Make it listen on the PORT environment variable and on 0.0.0.0."
    );
    expect(t.failure?.stage).toBe("health");
    expect(t.failure?.known).toBe(true);
    expect(t.failure?.note).toBe("The previous release is serving traffic again.");
    expect(t.summary).toMatch(/^The deployment failed at Health check\. Your app did not answer/);
  });

  it("reports a revert that did not come back", () => {
    const failedBack = buildTimeline(dep, metrics, [
      ...logs.slice(0, -1),
      log(125, "The previous release did not come back either. Check the logs."),
    ]);
    expect(failedBack.stages[5].status).toBe("failed");
    expect(failedBack.failure?.note).toMatch(/did not come back/);
  });

  it("tells a crash from a silence", () => {
    const crashed = buildTimeline(dep, metrics, [...beforeBuild, log(64, "Waiting for the app to answer on port 5173"), log(66, "Service crashed on start")]);
    expect(crashed.failure?.message).toMatch(/^Your app crashed as soon as it started on port 5173/);
  });

  it("still finds the health stage when the log was cut off and no measurement exists", () => {
    const bare = buildTimeline(dep, [], []);
    expect(bare.failure?.stage).toBe("health");
    expect(status(bare).health).toBe("failed");
    expect(bare.failure?.message).toBe("Your app did not become healthy on port 5173. Make it listen on the PORT environment variable and on 0.0.0.0.");
  });

  it("shows the revert as in progress while it happens", () => {
    const t2 = buildTimeline({ ...dep, state: "deploying", error: null, finishedAt: null }, metrics, logs.slice(0, -1));
    expect(status(t2).health).toBe("failed");
    expect(status(t2).reverted).toBe("current");
    expect(t2.outcome).toBe("running");
  });
});

describe("buildTimeline: a clone failure", () => {
  const dep: TimelineDeployment = {
    ...base,
    state: "error",
    startedAt: at(1),
    finishedAt: at(4),
    error: "Could not clone the repository. Check the branch name and that Egg has access to it.",
  };
  const t = buildTimeline(dep, [metric("source", 1, 4, "failed")], [log(1, "Deploying recipe-api (production) to sam@host"), log(4, "Could not clone the repository. Check the branch name and that Egg has access to it.", "error")]);

  it("fails at preparing and leaves later stages unreached", () => {
    expect(status(t)).toEqual({ queued: "done", preparing: "failed", building: "skipped", starting: "skipped", health: "skipped", live: "skipped" });
    expect(t.stages[1].durationMs).toBe(3000);
    expect(t.stages[2].detail).toBe("Not reached");
  });

  it("points at the branch and the GitHub app", () => {
    expect(t.failure?.message).toBe(
      "Egg could not clone your repository. Check the production branch in Settings and, for a private repository, that the GitHub app is installed on it."
    );
  });
});

describe("buildTimeline: a build failure", () => {
  const dep: TimelineDeployment = {
    ...base,
    state: "error",
    startedAt: at(1),
    finishedAt: at(40),
    error: "The build failed (exit 1). Your app is still running.",
  };
  const metrics = [...preMetrics, metric("build", 12, 39, "failed")];
  const t = buildTimeline(dep, metrics, [...beforeBuild, log(39, "Removed the unfinished release folder. Your running app was not changed.")]);

  it("fails at building", () => {
    expect(status(t)).toEqual({ queued: "done", preparing: "done", building: "failed", starting: "skipped", health: "skipped", live: "skipped" });
    expect(t.stages[2].durationMs).toBe(27_000);
  });

  it("names the step that failed and notes that the app is still running", () => {
    expect(t.failure?.message).toBe(
      'Your build command "npm run build" failed with exit code 1. Read the last error lines in the build output, fix them, then deploy again.'
    );
    expect(t.failure?.note).toBe("Your app is still running the release it had before.");
  });

  it("explains an out-of-memory build", () => {
    const oom = buildTimeline({ ...dep, error: "The build needed more memory than the cap of 1024 MB." }, metrics, beforeBuild);
    expect(oom.failure?.message).toMatch(/^The build ran out of memory at its cap of 1024 MB\. Raise Build memory on the Container page/);
  });

  it("adds a plain OOM explanation with the configured build cap and matching line", () => {
    const line = "The build failed (exit 137).";
    const oom = buildTimeline({ ...dep, error: line, buildMemoryLimitMb: 1024 }, metrics, beforeBuild);

    expect(oom.failure).toMatchObject({
      plainMessage: "Memory ran out. The configured limit is 1024 MB.",
      plainLine: line,
    });
  });
});

describe("buildTimeline: a canceled deploy", () => {
  it("marks the stage it was in as canceled", () => {
    const t = buildTimeline(
      { ...base, state: "canceled", startedAt: at(1), finishedAt: at(20), error: "Canceled" },
      [...preMetrics, metric("build", 12, 20, "failed")],
      beforeBuild
    );
    expect(status(t)).toEqual({ queued: "done", preparing: "done", building: "canceled", starting: "skipped", health: "skipped", live: "skipped" });
    expect(t.outcome).toBe("canceled");
    expect(t.failure).toBeNull();
    expect(t.summary).toBe("This deployment was canceled.");
    expect(t.stages[3].at).toBeNull();
  });

  it("is canceled while still queued", () => {
    const t = buildTimeline({ ...base, state: "canceled", finishedAt: at(3), error: "Canceled" });
    expect(status(t).queued).toBe("canceled");
    expect(status(t).preparing).toBe("skipped");
  });

  it("says why when the system canceled it", () => {
    expect(explainCancel("Pull request closed")).toBe("Canceled because the pull request was closed.");
    expect(explainCancel("Canceled")).toBe("This deployment was canceled.");
  });
});

describe("buildTimeline: other shapes", () => {
  it("shows a rollback without clone or build stages", () => {
    const dep: TimelineDeployment = { ...base, source: "rollback", state: "ready", startedAt: at(1), activationStartedAt: at(2), finishedAt: at(9) };
    const t = buildTimeline(dep, [], [log(1, "Rolling recipe-api back to release 1234abcd"), log(8, "Healthy: HTTP 200 on port 5173"), log(9, "Rollback complete. Database changes are not reversed.")]);
    expect(t.stages.map((s) => s.key)).toEqual(["queued", "starting", "health", "live"]);
    expect(t.stages[1].label).toBe("Switching release");
    expect(t.stages.every((s) => s.status === "done")).toBe(true);
  });

  it("fails a rollback at the health check", () => {
    const dep: TimelineDeployment = {
      ...base, source: "rollback", state: "error", startedAt: at(1), activationStartedAt: at(2), finishedAt: at(50),
      error: "The older release did not become healthy, so nothing was changed.",
    };
    const t = buildTimeline(dep, [], [log(49, "No healthy response on port 5173 after 45s")]);
    expect(status(t)).toEqual({ queued: "done", starting: "done", health: "failed", live: "skipped" });
    expect(t.failure?.message).toBe("The older release did not start answering health checks. Redeploy from your branch instead of rolling back.");
  });

  it("calls a deployment that ended before it started a queue failure", () => {
    const t = buildTimeline({ ...base, state: "error", finishedAt: at(2), error: "The deployment actor no longer has permission to deploy this project." });
    expect(status(t).queued).toBe("failed");
    expect(t.failure?.message).toMatch(/no longer has access to the project/);
  });

  it("copes with a dropped log: a ready deploy is done without times", () => {
    const t = buildTimeline({ ...base, state: "ready", startedAt: at(1), finishedAt: at(70) });
    expect(t.stages.every((s) => s.status === "done")).toBe(true);
    expect(t.stages[2].at).toBeNull();
  });

  it("accepts ISO strings as well as dates", () => {
    const t = buildTimeline({ ...base, createdAt: at(0).toISOString(), state: "queued" });
    expect(t.stages[0].at).toBe(at(0).toISOString());
  });
});

describe("explainFailure", () => {
  const msg = (error: string | null, logs: TimelineLog[] = []) => explainFailure({ error, logs, port: 3000 }).message;

  it.each([
    ["The root directory \"web\" does not exist in this repository.", 'The root directory "web" is not in your repository. Fix Root directory in Settings, then deploy again.'],
    ["Could not fetch requested commit 837638e. The branch tip was not used.", /^Egg could not get the exact commit/],
    ["The repository is larger than 500 MB, so it was not cloned.", "Your repository is larger than 500 MB, so Egg did not clone it. Remove large files from it, then deploy again."],
    ["Egg's disk is nearly full, so the repository was not cloned. Try again later.", /Egg's own disk is nearly full/],
    ["The source compressed source archive exceeds the 524288000 byte limit.", /too large to send to the container/],
    ["The build timed out.", /took longer than 5 minutes/],
    ["Repositories on gitlab.com are not supported yet. Supported: github.com.", "Egg can only deploy repositories on github.com. Check the repository in Settings."],
    ["The branch name is not valid.", /production branch in Settings/],
    ["GitHub did not send the build in time. Check the workflow run, then deploy again.", /Open the workflow run on GitHub/],
    ["The build GitHub sent did not match its checksum when it was read again. Run the workflow again.", "The build GitHub sent was damaged on the way. Run the workflow again."],
    ["The build from GitHub was refused. The archive has a link outside the folder.", /^Egg refused the build GitHub sent/],
    ["Timed out connecting to Nest. Your container may be stopped or starting; try again in a minute.", /could not reach your Nest container in time/],
    ["Could not reach the Nest SSH host (ECONNREFUSED).", /Nest SSH host/],
    ["Confirm host key: open the Connect page, check the fingerprint of this server and confirm it first.", /host key is not confirmed/],
    ["The host key of h changed (was a, now b). Nothing was sent. If you expected this, reconnect the server.", /host key changed/],
    ["SSH error: boom", /SSH error/],
    ["The build took longer than 15 minutes and was stopped.", "The build ran for more than 15 minutes and was stopped. Make the build faster, then deploy again."],
    ["The build stopped because the container's free disk space fell below 1024 MB. Free up disk space on your container, then deploy again.", /under 1024 MB of disk space free/],
    ["The build used more than 2048 MB of disk space and was stopped.", /used more than 2048 MB of disk/],
    ['The output folder "dist" was not created by the build.', 'The build did not create the output folder "dist". Set Output directory in Settings to the folder your build writes.'],
    ["The upload was corrupted (checksum mismatch). Deploy again.", "The upload to your container was damaged on the way. Deploy again."],
    ["Your container has no sha256sum, so the upload could not be checked. Install coreutils on the container and deploy again.", /no sha256sum command/],
    ["The source could not be unpacked on your container (exit 2).", "Your container could not unpack the source (exit 2). Check its free disk space, then deploy again."],
    ["The build did not start: your container reports 600 MB of memory, and 512 MB of that is kept for your app, which leaves too little to build in. Use a larger container.", /reports 600 MB of memory/],
    ["Another build has been running on this container for more than 30 minutes, so this one did not start. Your app is still running.", /held this container for more than 30 minutes/],
    ["A previous build on this container stopped reporting in, and Egg could not confirm that it has stopped running on your container, so this build did not start.", /egg-build/],
    ["This build stopped reporting in for too long, so another deployment took over this container's build lock and this build was stopped. Deploy again.", /took over the container's build slot/],
    ["Static sites need Python 3 or Node.js on your Nest container to be served.", /Install one of them/],
    ["Registering the service failed (exit 1).", 'Egg could not finish "registering the service" on your container (exit 1). Read the lines above it in the log, then deploy again.'],
    ["That release is no longer on your server (old releases are removed to save disk space).", /removed from your server/],
    ["The pull request closed while its preview was starting.", /Reopen the pull request/],
    ["The operator recovered an interrupted build.", /interrupted/],
  ])("explains %j", (error, expected) => {
    const got = msg(error);
    if (typeof expected === "string") expect(got).toBe(expected);
    else expect(got).toMatch(expected);
  });

  it.each([
    "Free up disk space on your container: 900 MB is free and a build needs at least 2048 MB.",
    "Install Node.js 22.13 or newer on your container (nodejs.org), then deploy again.",
    "Install Python 3 on your container: sudo apt install python3",
    "Set a start command for this project (for example ./my-binary).",
    "Egg could not check your container before building, so nothing was uploaded. Check that the container is running and try again.",
  ])("keeps the fix line %j as written", (error) => {
    const got = explainFailure({ error });
    expect(got.known).toBe(true);
    expect(got.message).toBe(error);
  });

  it("uses a neutral sentence that points at the log for anything it does not know", () => {
    for (const error of ["Something odd happened", "", null]) {
      const f = explainFailure({ error });
      expect(f.known).toBe(false);
      expect(f.message).toBe("Egg could not finish this deployment. Read the last lines of the log below to see why, then deploy again.");
    }
    expect(explainFailure({ error: "Something odd happened" }).recorded).toBe("Something odd happened");
    expect(explainFailure({ error: "Something odd happened" })).toMatchObject({ plainMessage: null, plainLine: null });
  });

  it("adds a plain explanation and raw matching line to the deployment failure", () => {
    const line = "Error: listen EADDRINUSE: address already in use :::3000";
    const timeline = buildTimeline(
      {
        ...base,
        state: "error",
        startedAt: at(1),
        activationStartedAt: at(2),
        finishedAt: at(4),
        error: "The new release did not become healthy on port 3000.",
      },
      [metric("activation", 2, 3), metric("health", 3, 4, "failed")],
      [log(3, line, "error")],
    );

    expect(timeline.failure).toMatchObject({
      message: "Your app did not become healthy on port 3000. Make it listen on the PORT environment variable and on 0.0.0.0.",
      known: true,
      plainMessage: "Port 3000 is already in use by another process.",
      plainLine: line,
    });
  });

  it("states the server memory limit when the app is killed during startup", () => {
    const line = "Process exited with code 137.";
    const timeline = buildTimeline(
      {
        ...base,
        state: "error",
        startedAt: at(1),
        activationStartedAt: at(2),
        finishedAt: at(3),
        error: line,
        serverMemoryLimitMb: 4096,
      },
      [],
      [log(3, line, "error")],
    );

    expect(timeline.failure).toMatchObject({
      stage: "starting",
      plainMessage: "Memory ran out. The configured limit is 4096 MB.",
      plainLine: line,
    });
  });

  it("keeps a failed install apart from a failed build", () => {
    const logs = [log(1, "Installing: npm ci"), log(9, "npm error 404")];
    expect(msg("The build failed (exit 1).", logs)).toMatch(/^Your install command "npm ci" failed with exit code 1/);
  });
});

describe("formatStageDuration", () => {
  it("writes short spans plainly", () => {
    expect(formatStageDuration(400)).toBe("under 1s");
    expect(formatStageDuration(12_000)).toBe("12s");
    expect(formatStageDuration(65_000)).toBe("1m 5s");
    expect(formatStageDuration(null)).toBeNull();
  });
});

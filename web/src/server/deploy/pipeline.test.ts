import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { envForDeployment, mergeEnvForDeployment, runDeployJob, runRollbackJob, type PipelineDeps } from "@/server/deploy/pipeline";
import {
  createProject,
  cancelDeployment,
  deployBranch,
  deploymentLogs,
  listDeployments,
  rollback,
  setEnvVar,
  type ProjectRow,
} from "@/server/projects";
import { connectToServer, createServer, getServerForUser, type ServerRow } from "@/server/servers";
import { NestSession } from "@/server/ssh/connection";
import { closePullRequestPreviews } from "@/server/github/pulls";
import {
  brokenApp,
  fakeBuilder,
  freePort,
  containerReadyFacts,
  installFakeContainerBuild,
  installFakeSystemd,
  nodeApp,
  type FixtureFiles,
} from "@/server/test/fake-nest";
import { useFreshDb } from "@/server/test/db";
import { startMockSsh, type MockSsh } from "@/server/test/mock-ssh";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let mock: MockSsh;
let userId: string;
let server: ServerRow;
let project: ProjectRow;
let deps: PipelineDeps;
let files: FixtureFiles = nodeApp("v1");
const buildLogs: string[] = [];

async function sh(command: string) {
  const s = await NestSession.connect({
    host: "127.0.0.1",
    port: mock.port,
    username: "sam-r",
    privateKey: (await import("@/server/crypto")).open(server.privateKeyEnc, `server:${server.id}`),
  });
  try {
    return (await s.exec(command)).stdout.trim();
  } finally {
    s.close();
  }
}

async function deploy(branch = "main") {
  const dep = await deployBranch(userId, project.id, branch);
  await runDeployJob(dep.id, deps);
  if (process.env.DEBUG_DEPLOY) {
    const logs = await deploymentLogs(userId, dep.id);
    console.log(logs.map((l) => `[${l.level}] ${l.message}`).join("\n"));
  }
  return ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get() as Promise<
    typeof schema.deployments.$inferSelect
  >;
}

const answer = (port: number) => sh(`curl -s --max-time 3 http://127.0.0.1:${port}/`);

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;

  mock = await startMockSsh({ authorizedKeys: [] });
  installFakeSystemd(mock);
  installFakeContainerBuild(mock);
  await mock.stop();

  // Create the server first so we know the key, then start the mock with it.
  server = await createServer(userId, "sam-r", { host: "127.0.0.1", port: 1 });
  mock = await startMockSsh({ authorizedKeys: [server.publicKey] });
  installFakeSystemd(mock);
  installFakeContainerBuild(mock);
  await ctx.db.update(schema.servers).set({ port: mock.port, hostKeyFingerprint: mock.hostKeyFingerprint }).where(eq(schema.servers.id, server.id));
  server = await getServerForUser(userId, server.id);

  const port = await freePort();
  project = await createProject(userId, {
    serverId: server.id,
    name: "Demo App",
    repoUrl: "https://github.com/example/demo",
    runtime: "node",
    startCommand: "node server.js",
    port,
    healthPath: "/",
  });
  await setEnvVar(userId, project.id, { key: "GREETING", value: "hello-secret-value", target: "all" });

  deps = {
    preflight: () => async () => containerReadyFacts,
    lockPollMs: 50,
    sourceBuild: fakeBuilder(() => files, { onBuild: (r) => buildLogs.push(r.source.branch) }),
    connect: connectToServer,
    unitDir: `${mock.home.replace(/\\/g, "/")}/units`,
    healthTimeoutSeconds: 8,
  };
});

afterAll(async () => {
  // Stop any fake services so their ports are released.
  for (const unit of await sh("ls $HOME/units 2>/dev/null || true").then((t) => t.split(/\s+/).filter(Boolean))) {
    await sh(`systemctl stop ${unit}`).catch(() => {});
  }
  await mock.stop();
  await ctx.cleanup();
});

// A deploy is roughly 15 SSH commands; tests that deploy several times in a row get a longer budget.
const DEPLOY_LOOP_TIMEOUT = 90000;

describe("deploy pipeline", () => {
  let v1: typeof schema.deployments.$inferSelect;
  let v2: typeof schema.deployments.$inferSelect;

  it("lets production and preview values override all regardless of insertion order", async () => {
    expect(mergeEnvForDeployment([
      { key: "OVERRIDE_ME", target: "preview", value: "preview-first" },
      { key: "OVERRIDE_ME", target: "production", value: "production-first" },
      { key: "OVERRIDE_ME", target: "all", value: "all-last" },
    ], "preview")).toEqual({ OVERRIDE_ME: "preview-first" });
    expect(mergeEnvForDeployment([
      { key: "OVERRIDE_ME", target: "preview", value: "preview-first" },
      { key: "OVERRIDE_ME", target: "production", value: "production-first" },
      { key: "OVERRIDE_ME", target: "all", value: "all-last" },
    ], "production")).toEqual({ OVERRIDE_ME: "production-first" });
    expect(await envForDeployment(project.id, "preview")).toMatchObject({ GREETING: "hello-secret-value" });
  });

  it("ships a production release, starts it and passes the health check", async () => {
    files = nodeApp("v1");
    v1 = await deploy();
    expect(v1.state).toBe("ready");
    expect(v1.isCurrent).toBe(true);
    expect(v1.commitSha).toBe("a".repeat(40));
    expect(v1.archiveBytes).toBeGreaterThan(0);
    expect(await answer(project.port)).toBe("v1:hello-secret-value");
  });

  it("writes the service file, a locked-down env file and the current symlink", async () => {
    const home = mock.home.replace(/\\/g, "/");
    const unit = await sh(`cat ${home}/units/egg-demo-app.service`);
    expect(unit).toContain(`Environment=PORT=${project.port}`);
    expect(unit).toContain("Environment=HOST=0.0.0.0");
    expect(unit).toContain('ExecStart=/bin/bash -lc "exec node server.js"');
    expect(unit).toContain("Restart=always");

    const envFile = await sh(`cat ${home}/.egg/demo-app/env/${v1.releaseId}.env`);
    expect(envFile).toBe('GREETING="hello-secret-value"');
    const link = await sh(`readlink ${home}/.egg/demo-app/current`);
    expect(link.replace(/\\/g, "/")).toContain(v1.releaseId);
    const envLink = await sh(`readlink ${home}/.egg/demo-app/current.env`);
    expect(envLink.replace(/\\/g, "/")).toContain(`/env/${v1.releaseId}.env`);
  });

  it("never stores secret values in the deployment log", async () => {
    const logs = await deploymentLogs(userId, v1.id);
    const text = logs.map((l) => l.message).join("\n");
    expect(text).toContain("build env: ***");
    expect(text).not.toContain("hello-secret-value");
    expect(text).toContain("Healthy");
    expect(text).toContain("Live on port");
  });

  it("deploys a second release and makes it current", async () => {
    files = nodeApp("v2");
    v2 = await deploy();
    expect(v2.state).toBe("ready");
    expect(v2.isCurrent).toBe(true);
    const all = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, v1.id)).get();
    expect(all?.isCurrent).toBe(false);
    expect(await answer(project.port)).toBe("v2:hello-secret-value");
  });

  it("rolls back to the first release without rebuilding", async () => {
    const before = mock.commands.length;
    const rb = await rollback(userId, v1.id);
    expect(rb.source).toBe("rollback");
    expect(rb.releaseId).toBe(v1.releaseId);
    await runRollbackJob(rb.id, deps);

    const done = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, rb.id)).get();
    expect(done?.state).toBe("ready");
    expect(done?.isCurrent).toBe(true);
    expect(await answer(project.port)).toBe("v1:hello-secret-value");
    expect(mock.commands.length).toBeGreaterThan(before);
  });

  it("does not switch a rollback canceled while reading the current unit", async () => {
    const rb = await rollback(userId, v2.id);
    const abort = new AbortController();
    const cancelDuringUnitRead: PipelineDeps = {
      ...deps,
      connect: async (srv) => {
        const session = await deps.connect(srv);
        return new Proxy(session, {
          get(target, prop) {
            const value = Reflect.get(target, prop, target);
            if (prop !== "exec") return typeof value === "function" ? value.bind(target) : value;
            return async (command: string, options?: unknown) => {
              const result = await target.exec(command, options as never);
              if (command.includes("egg-demo-app.service")) {
                await cancelDeployment(userId, rb.id);
                abort.abort();
              }
              return result;
            };
          },
        });
      },
    };

    await runRollbackJob(rb.id, cancelDuringUnitRead, abort.signal);

    const canceled = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, rb.id)).get();
    const currentRows = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.isCurrent, true));
    expect(canceled?.state).toBe("canceled");
    expect(currentRows.some((row) => row.projectId === project.id && row.releaseId === v1.releaseId)).toBe(true);
    expect(await answer(project.port)).toBe("v1:hello-secret-value");
  }, DEPLOY_LOOP_TIMEOUT);

  it("reverts automatically when a new release is unhealthy", async () => {
    files = brokenApp();
    const bad = await deploy();
    expect(bad.state).toBe("error");
    expect(bad.isCurrent).toBe(false);
    expect(bad.error).toContain("did not become healthy");

    // Production is still answering with the release that was live before.
    expect(await answer(project.port)).toBe("v1:hello-secret-value");

    const text = (await deploymentLogs(userId, bad.id)).map((l) => l.message).join("\n");
    expect(text).toContain("Reverting to the previous release");
    expect(text).toContain("serving traffic again");
  });

  it("runs a preview on its own port and leaves production alone", async () => {
    files = nodeApp("preview");
    const pv = await deploy("feature/x");
    expect(pv.env).toBe("preview");
    expect(pv.state, pv.error ?? "").toBe("ready");
    expect(pv.isCurrent).toBe(false);
    expect(pv.port).toBeGreaterThanOrEqual(20000);
    expect(await answer(pv.port)).toBe("preview:hello-secret-value");
    expect(await answer(project.port)).toBe("v1:hello-secret-value");
  });

  it("keeps only the newest previews", async () => {
    const ports: number[] = [];
    for (const n of [1, 2, 3]) {
      files = nodeApp(`p${n}`);
      ports.push((await deploy(`feature/${n}`)).port);
    }
    const previews = (await listDeployments(userId, project.id, 100)).filter(
      (r) => r.deployment.env === "preview" && r.deployment.state === "ready"
    );
    const active = previews.filter((r) => !r.deployment.cleanedUp);
    expect(active.length).toBe(2);
    // The oldest preview's service was stopped and its folder removed.
    expect(await answer(ports[0])).toBe("");
    expect(await answer(ports[2])).toBe("p3:hello-secret-value");
    // Each deploy is about 15 commands, and every command is a separate wsl.exe start on Windows, so
    // several deploys in one test need more than the global 20s.
  }, DEPLOY_LOOP_TIMEOUT);

  it("prunes old production releases but never the live one", async () => {
    for (let i = 0; i < 6; i++) {
      files = nodeApp(`r${i}`);
      await deploy();
    }
    const home = mock.home.replace(/\\/g, "/");
    const dirs = (await sh(`ls ${home}/.egg/demo-app/releases`)).split(/\s+/).filter(Boolean);
    const rows = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.projectId, project.id));
    const live = rows.find((r) => r.env === "production" && r.isCurrent)!;
    expect(dirs).toContain(live.releaseId);
    expect(dirs.length).toBeLessThanOrEqual(5 + 2); // 5 production + up to 2 previews
    expect(await answer(project.port)).toBe("r5:hello-secret-value");
    expect(rows.some((r) => r.cleanedUp && r.env === "production")).toBe(true);
  }, DEPLOY_LOOP_TIMEOUT);

  it("refuses to roll back to a release that was pruned", async () => {
    await expect(rollback(userId, v1.id)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects cancellation once the activation boundary is claimed", async () => {
    const dep = await deployBranch(userId, project.id, "main");
    const cancelAfterBoundary: PipelineDeps = {
      ...deps,
      connect: async (srv) => {
        const session = await deps.connect(srv);
        return new Proxy(session, {
          get(target, prop) {
            const value = Reflect.get(target, prop, target);
            if (prop !== "writeFile") return typeof value === "function" ? value.bind(target) : value;
            return async (path: string, content: string, mode?: string, options?: unknown) => {
              if (path.endsWith("egg-demo-app.service")) {
                await expect(cancelDeployment(userId, dep.id)).rejects.toMatchObject({ status: 409 });
              }
              return target.writeFile(path, content, mode, options as never);
            };
          },
        });
      },
    };
    await runDeployJob(dep.id, cancelAfterBoundary);
    const after = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get();
    expect(after?.state).toBe("ready");
    expect(after?.activationStartedAt).toBeInstanceOf(Date);
  }, DEPLOY_LOOP_TIMEOUT);
});

describe("deploy state races", () => {
  it.each([false, true])("does not revive a preview closed after its health check (removal fails: %s)", async (removalFails) => {
    files = nodeApp("closed-preview");
    const dep = await deployBranch(userId, project.id, "closed-pr");
    await ctx.db.update(schema.deployments).set({ prNumber: 99 }).where(eq(schema.deployments.id, dep.id));
    // Keep the worker's guard until it has completely stopped touching the release.
    await ctx.db.update(schema.jobs).set({ state: "running" }).where(eq(schema.jobs.deploymentId, dep.id));
    let closed = false;
    await runDeployJob(dep.id, {
      ...deps,
      connect: async (srv) => {
        const session = await deps.connect(srv);
        return new Proxy(session, {
          get(target, prop) {
            const value = Reflect.get(target, prop, target);
            if (prop !== "script") return typeof value === "function" ? value.bind(target) : value;
            return async (...args: Parameters<NestSession["script"]>) => {
              if (closed && removalFails && args[0].includes("egg_unit_marked") && args[0].includes("rm -rf")) {
                return { code: 45, stdout: "", stderr: "Service could not stop" };
              }
              const result = await target.script(...args);
              if (!closed && args[0].includes('Healthy: HTTP') && result.code === 0) {
                closed = true;
                await closePullRequestPreviews(project.id, 99);
              }
              return result;
            };
          },
        });
      },
    });
    expect(closed).toBe(true);
    const row = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get();
    expect(row?.state).toBe("canceled");
    expect(row?.error).toBe("Pull request closed");
    expect(row?.cleanedUp).toBe(!removalFails);
    expect(await sh(`test -d "$HOME/.egg/demo-app/releases/${dep.releaseId}" && echo exists || echo absent`)).toBe(removalFails ? "exists" : "absent");
    await ctx.db.update(schema.jobs).set({ state: "done" }).where(eq(schema.jobs.deploymentId, dep.id));
  }, DEPLOY_LOOP_TIMEOUT);

  it("does not deploy, or revive, a deployment that was canceled while it was building", async () => {
    files = nodeApp("never-ships");
    const dep = await deployBranch(userId, project.id, "main");
    const cancelDuringBuild: PipelineDeps = {
      ...deps,
      // The cancel button writes straight to the database; the abort signal only follows on the next poll.
      sourceBuild: async (req) => {
        await ctx.db.update(schema.deployments).set({ state: "canceled" }).where(eq(schema.deployments.id, dep.id));
        return deps.sourceBuild!(req);
      },
    };
    await runDeployJob(dep.id, cancelDuringBuild);

    const row = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get();
    expect(row?.state).toBe("canceled");
    expect(row?.isCurrent).toBe(false);
    const home = mock.home.replace(/\\/g, "/");
    const dirs = await sh(`ls ${home}/.egg/demo-app/releases`);
    expect(dirs).not.toContain(dep.releaseId);
    expect(await answer(project.port)).not.toBe("never-ships:hello-secret-value");
  });
});

describe("runtime variables stay out of the release folder", () => {
  const home = () => mock.home.replace(/\\/g, "/");
  const proj = () => `${home()}/.egg/demo-app`;

  it("writes each release's file beside the release folder, mode 600 in a 700 folder, and none inside any release", async () => {
    files = nodeApp("sec1");
    const dep = await deploy();
    expect(dep.state, dep.error ?? "").toBe("ready");
    expect(await sh(`stat -c %a '${proj()}/env' '${proj()}/env/${dep.releaseId}.env'`)).toBe("700\n600");
    expect(await sh(`test -e '${proj()}/releases/${dep.releaseId}/.env' && echo inside || echo clean`)).toBe("clean");
    // No release folder holds a .env at its top level, which is the folder a static app serves.
    expect(await sh(`ls -A ${proj()}/releases/*/.env 2>/dev/null | wc -l`)).toBe("0");
    const unit = await sh(`cat ${home()}/units/egg-demo-app.service`);
    expect(unit).toContain(`EnvironmentFile=${proj()}/current.env`);
    expect(unit).not.toContain("current/.env");
  }, DEPLOY_LOOP_TIMEOUT);

  it("a preview reads its own file, and removing the preview removes the file", async () => {
    // Earlier tests leave preview services running on their ports; stop them so this one can have a port.
    await sh("for u in $HOME/units/egg-demo-app-pv-*.service; do [ -e \"$u\" ] && systemctl stop \"$(basename \"$u\")\"; done; true");
    files = nodeApp("pvsec");
    const pv = await deploy("feature/env-out");
    expect(pv.state, pv.error ?? "").toBe("ready");
    const unit = await sh(`cat ${home()}/units/egg-demo-app-pv-${pv.releaseId.slice(0, 8)}.service`);
    expect(unit).toContain(`EnvironmentFile=${proj()}/env/${pv.releaseId}.env`);
    expect(await sh(`test -e '${proj()}/releases/${pv.releaseId}/.env' && echo inside || echo clean`)).toBe("clean");
    for (const n of [1, 2, 3]) {
      files = nodeApp(`pvs${n}`);
      await deploy(`feature/env-out-${n}`);
    }
    // The first preview is beyond the newest two now: its folder and its file are both gone.
    expect(await sh(`test -e '${proj()}/releases/${pv.releaseId}' || test -e '${proj()}/env/${pv.releaseId}.env' && echo left || echo gone`)).toBe("gone");
  }, DEPLOY_LOOP_TIMEOUT);

  it("a rollback brings back the variables its target was deployed with", async () => {
    await setEnvVar(userId, project.id, { key: "GREETING", value: "first-value", target: "all" });
    files = nodeApp("A");
    const a = await deploy();
    await setEnvVar(userId, project.id, { key: "GREETING", value: "second-value", target: "all" });
    files = nodeApp("B");
    const b = await deploy();
    expect(a.state, a.error ?? "").toBe("ready");
    expect(b.state, b.error ?? "").toBe("ready");
    expect(await answer(project.port)).toBe("B:second-value");

    const rb = await rollback(userId, a.id);
    await runRollbackJob(rb.id, deps);
    expect(await answer(project.port)).toBe("A:first-value");
    expect(await sh(`readlink '${proj()}/current.env'`)).toBe(`${proj()}/env/${a.releaseId}.env`);
  }, DEPLOY_LOOP_TIMEOUT);

  it("a release deployed before the move still rolls back, and its old .env leaves the release folder", async () => {
    await setEnvVar(userId, project.id, { key: "GREETING", value: "legacy-one", target: "all" });
    files = nodeApp("L1");
    const l1 = await deploy();
    await setEnvVar(userId, project.id, { key: "GREETING", value: "legacy-two", target: "all" });
    files = nodeApp("L2");
    const l2 = await deploy();
    expect(l2.state, l2.error ?? "").toBe("ready");

    // Put the project back the way an earlier Egg left it: the file inside each release, the unit reading current/.env.
    await sh(`set -e; p='${proj()}'
for id in ${l1.releaseId} ${l2.releaseId}; do mv "$p/env/$id.env" "$p/releases/$id/.env"; done
rm -f "$p/current.env"
sed -i "s|^EnvironmentFile=.*|EnvironmentFile=$p/current/.env|" '${home()}/units/egg-demo-app.service'`);
    expect(await sh(`grep '^EnvironmentFile=' ${home()}/units/egg-demo-app.service`)).toBe(`EnvironmentFile=${proj()}/current/.env`);

    const rb = await rollback(userId, l1.id);
    await runRollbackJob(rb.id, deps);
    const done = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, rb.id)).get();
    expect(done?.state, done?.error ?? "").toBe("ready");
    expect(await answer(project.port)).toBe("L1:legacy-one");
    // The target's own .env is out of its folder, and the unit now reads the link.
    expect(await sh(`test -e '${proj()}/releases/${l1.releaseId}/.env' && echo inside || echo clean`)).toBe("clean");
    expect(await sh(`stat -c %a '${proj()}/env/${l1.releaseId}.env'`)).toBe("600");
    expect(await sh(`grep '^EnvironmentFile=' ${home()}/units/egg-demo-app.service`)).toBe(`EnvironmentFile=${proj()}/current.env`);

    // The next deploy moves the other old release's file out of its folder too.
    files = nodeApp("L3");
    const l3 = await deploy();
    expect(l3.state, l3.error ?? "").toBe("ready");
    expect(await sh(`ls -A ${proj()}/releases/*/.env 2>/dev/null | wc -l`)).toBe("0");
    expect(await sh(`cat '${proj()}/env/${l2.releaseId}.env'`)).toBe('GREETING="legacy-two"');
  }, DEPLOY_LOOP_TIMEOUT * 2);
});

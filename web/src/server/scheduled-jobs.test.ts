import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { upsertUser } from "@/server/auth/session";
import { resetConfigForTests } from "@/server/config";
import { open } from "@/server/crypto";
import { schema } from "@/server/db";
import { runDeployJob, type PipelineDeps } from "@/server/deploy/pipeline";
import { installJob, jobServiceFile, jobTimerFile, jobUnits } from "@/server/deploy/jobs-remote";
import { parseSchedule } from "@/lib/cron-schedule";
import { createProject, deployBranch, type ProjectRow } from "@/server/projects";
import { removeProjectFromServer } from "@/server/runtime-info";
import {
  MAX_JOBS_PER_PROJECT,
  createJob,
  deleteJob,
  fetchJobLogs,
  fetchJobStatuses,
  jobUnitNames,
  listJobs,
  parseJobStatuses,
  runJob,
  updateJob,
} from "@/server/scheduled-jobs";
import { connectToServer, createServer, getServerForUser, type ServerRow } from "@/server/servers";
import { NestSession } from "@/server/ssh/connection";
import { fakeBuilder, freePort, containerReadyFacts, installFakeContainerBuild, installFakeSystemd, nodeApp } from "@/server/test/fake-nest";
import { useFreshDb } from "@/server/test/db";
import { startMockSsh, type MockSsh } from "@/server/test/mock-ssh";

describe("parseJobStatuses", () => {
  const ids = ["a", "b", "c", "d"];
  const output = [
    "J0_LoadState=loaded", "J0_ActiveState=inactive", "J0_Result=success", "J0_ExecMainStatus=0",
    "J0_TimerActiveState=active", "J0_LastEnd=1794571200",
    "J1_LoadState=loaded", "J1_ActiveState=failed", "J1_Result=exit-code", "J1_ExecMainStatus=3",
    "J1_TimerActiveState=active", "J1_LastEnd=1794571260",
    "J2_LoadState=not-found", "J2_ActiveState=inactive",
    "J3_LoadState=loaded", "J3_ActiveState=activating", "J3_Result=success", "J3_TimerActiveState=inactive",
  ].join("\n");

  it("tells ok, failed, missing and running apart", () => {
    const [ok, failed, missing, running] = parseJobStatuses(output, ids);
    expect(ok).toMatchObject({ state: "ok", exitCode: null, armed: true, lastEndedAt: new Date(1794571200 * 1000).toISOString() });
    expect(failed).toMatchObject({ state: "failed", exitCode: 3, armed: true });
    expect(missing).toMatchObject({ state: "missing", armed: false });
    expect(running).toMatchObject({ state: "running", armed: false });
  });

  it("says never for a job that has not run and copes with garbage", () => {
    expect(parseJobStatuses("J0_LoadState=loaded\nJ0_ActiveState=inactive\nJ0_Result=success\nJ0_TimerActiveState=active", ["x"])[0]).toMatchObject({
      state: "never",
      lastEndedAt: null,
    });
    expect(parseJobStatuses("nonsense\nJ9_X=1", ["x"])[0].state).toBe("missing");
    expect(parseJobStatuses("", [])).toEqual([]);
  });
});

describe("job unit files", () => {
  const id = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
  const base = { slug: "demo", jobId: id, name: "Nightly clean-up", home: "/home/sam-r" };

  it("names the units after the project and the job", () => {
    expect(jobUnits("demo", id)).toEqual({ service: "egg-demo-job-0f1e2d3c.service", timer: "egg-demo-job-0f1e2d3c.timer" });
    expect(() => jobUnits("demo", "../../etc")).toThrow();
  });

  it("writes a oneshot service that runs in the current release with the app's variables", () => {
    const file = jobServiceFile({ ...base, command: "node scripts/prune.js --days 30" });
    expect(file.split("\n")[0]).toBe(`# egg:managed project=demo job=${id}`);
    expect(file).toContain("Type=oneshot");
    expect(file).toContain("WorkingDirectory=/home/sam-r/.egg/demo/current");
    expect(file).toContain("EnvironmentFile=-/home/sam-r/.egg/demo/current.env");
    expect(file).toContain('ExecStart=/bin/bash -lc "node scripts/prune.js --days 30"');
    expect(file).toContain("TimeoutStartSec=1800");
    expect(file).toContain("OOMScoreAdjust=500");
  });

  it("escapes systemd's own syntax in the command", () => {
    const file = jobServiceFile({ ...base, command: 'echo "$HOME" 100%' });
    expect(file).toContain('ExecStart=/bin/bash -lc "echo \\"$$HOME\\" 100%%"');
  });

  it("writes a timer in UTC that does not catch up after downtime", () => {
    const file = jobTimerFile({ ...base, schedule: parseSchedule("30 3 * * *") });
    expect(file).toContain("OnCalendar=*-*-* 03:30:00 UTC");
    expect(file).toContain("Persistent=false");
    expect(file).toContain("Unit=egg-demo-job-0f1e2d3c.service");
    expect(file).toContain("WantedBy=timers.target");
  });
});

describe("scheduled jobs on a mock Nest", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let mock: MockSsh;
  let userId: string;
  let server: ServerRow;
  let project: ProjectRow;
  let idle: ProjectRow;
  let deps: PipelineDeps;
  let unitDir: string;

  async function sh(command: string) {
    const s = await NestSession.connect({
      host: "127.0.0.1",
      port: mock.port,
      username: "sam-r",
      privateKey: open(server.privateKeyEnc, `server:${server.id}`),
    });
    try {
      return (await s.exec(command)).stdout.trim();
    } finally {
      s.close();
    }
  }

  const unitFiles = async () => (await sh(`ls ${unitDir} | grep -v '^.keep$' || true`)).split(/\s+/).filter(Boolean);

  beforeAll(async () => {
    ctx = await useFreshDb();
    userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
    server = await createServer(userId, "sam-r", { host: "127.0.0.1", port: 1 });
    mock = await startMockSsh({ authorizedKeys: [server.publicKey] });
    installFakeSystemd(mock);
    installFakeContainerBuild(mock);
    unitDir = `${mock.home.replace(/\\/g, "/")}/units`;
    process.env.UNIT_DIR = unitDir;
    resetConfigForTests();
    await ctx.db.update(schema.servers).set({ port: mock.port, hostKeyFingerprint: mock.hostKeyFingerprint }).where(eq(schema.servers.id, server.id));
    server = await getServerForUser(userId, server.id);

    const base = { serverId: server.id, repoUrl: "https://github.com/example/demo", runtime: "node" as const };
    project = await createProject(userId, { ...base, name: "Jobs App", startCommand: "node server.js", port: await freePort() });
    idle = await createProject(userId, { ...base, name: "Never Deployed", startCommand: "node server.js", port: await freePort() });
    deps = {
      preflight: () => async () => containerReadyFacts,
      lockPollMs: 50,
      sourceBuild: fakeBuilder(() => nodeApp("v1")),
      connect: connectToServer,
      unitDir,
      healthTimeoutSeconds: 8,
    };
  });

  afterAll(async () => {
    delete process.env.UNIT_DIR;
    resetConfigForTests();
    for (const unit of await unitFiles()) await sh(`systemctl stop ${unit}`).catch(() => {});
    await mock.stop();
    await ctx.cleanup();
  });

  const nightly = { name: "Nightly report", schedule: "30 3 * * *", command: "echo hello-from-job && pwd" };

  it("refuses to add a job before the first deployment", async () => {
    await expect(createJob(userId, idle.id, nightly)).rejects.toMatchObject({ status: 409, code: "not_deployed" });
    expect(await listJobs(userId, idle.id)).toEqual([]);
    expect(await unitFiles()).toEqual([]);
  });

  it("checks the input before it touches the container", async () => {
    await expect(createJob(userId, project.id, { ...nightly, schedule: "* * * * *" })).rejects.toMatchObject({ status: 400 });
    await expect(createJob(userId, project.id, { ...nightly, schedule: "0 0 1 * 1" })).rejects.toMatchObject({ status: 400 });
    await expect(createJob(userId, project.id, { ...nightly, command: "echo a\necho b" })).rejects.toBeInstanceOf(ZodError);
    await expect(createJob(userId, project.id, { ...nightly, command: "  " })).rejects.toBeInstanceOf(ZodError);
    await expect(createJob(userId, project.id, { ...nightly, name: "bad;name" })).rejects.toBeInstanceOf(ZodError);
    expect(await unitFiles()).toEqual([]);
  });

  it("installs a timer and a service for a new job and shows when it runs next", async () => {
    const dep = await deployBranch(userId, project.id);
    await runDeployJob(dep.id, deps);

    // Existing installs can still have the old environment file inside current/.
    // Job installation performs the migration before writing its unit.
    const projectDir = `${mock.home}/.egg/${project.slug}`;
    await sh(`mv '${projectDir}/env/${dep.releaseId}.env' '${projectDir}/releases/${dep.releaseId}/.env'
printf 'LEGACY="kept"\\n' > '${projectDir}/releases/${dep.releaseId}/.env'
rm '${projectDir}/current.env'
sed -i 's|EnvironmentFile=${projectDir}/current.env|EnvironmentFile=${projectDir}/current/.env|' '${unitDir}/egg-${project.slug}.service'`);

    const job = await createJob(userId, project.id, nightly);
    expect(job).toMatchObject({ name: "Nightly report", schedule: "30 3 * * *", description: "Every day at 03:30 UTC", enabled: true });
    expect(new Date(job.nextRunAt!).getUTCHours()).toBe(3);
    expect(new Date(job.nextRunAt!).getUTCMinutes()).toBe(30);

    const files = await unitFiles();
    const { service, timer } = jobUnits(project.slug, job.id);
    expect(files).toEqual(expect.arrayContaining([service, timer]));
    expect(await sh(`cat ${unitDir}/${timer}`)).toContain("OnCalendar=*-*-* 03:30:00 UTC");
    const migrated = await sh(`cat '${projectDir}/env/${dep.releaseId}.env'`);
    expect(migrated).toContain('LEGACY="kept"');
    expect(await sh(`readlink '${projectDir}/current.env'`)).toBe(`${projectDir}/env/${dep.releaseId}.env`);
    expect(await sh(`test ! -e '${projectDir}/releases/${dep.releaseId}/.env' && grep -F 'EnvironmentFile=${projectDir}/current.env' '${unitDir}/egg-${project.slug}.service' && grep -F 'EnvironmentFile=-${projectDir}/current.env' '${unitDir}/${service}'`)).toContain("EnvironmentFile");

    const [status] = await fetchJobStatuses(userId, project.id);
    expect(status).toMatchObject({ id: job.id, state: "never", armed: true, lastEndedAt: null });
  });

  it("runs a job on demand and keeps its output and result", async () => {
    const [job] = await listJobs(userId, project.id);
    await runJob(userId, project.id, job.id);

    const [status] = await fetchJobStatuses(userId, project.id);
    expect(status.state).toBe("ok");
    expect(new Date(status.lastEndedAt!).getTime()).toBeGreaterThan(Date.now() - 60_000);

    const logs = (await fetchJobLogs(userId, project.id, job.id)).join("\n");
    expect(logs).toContain("hello-from-job");
    // It ran inside the current release, not the project's top folder.
    expect(logs).toMatch(/\.egg\/jobs-app\/(current|releases)/);
  });

  it("reports a failing job with its exit code", async () => {
    const failing = await createJob(userId, project.id, { name: "Breaks", schedule: "0 * * * *", command: "echo about-to-fail; exit 3" });
    await runJob(userId, project.id, failing.id);
    const statuses = await fetchJobStatuses(userId, project.id);
    expect(statuses.find((s) => s.id === failing.id)).toMatchObject({ state: "failed", exitCode: 3 });
    expect(statuses.find((s) => s.id !== failing.id)?.state).toBe("ok");
    await deleteJob(userId, project.id, failing.id);
  });

  it("pauses, resumes and edits a job", async () => {
    const [job] = await listJobs(userId, project.id);
    const paused = await updateJob(userId, project.id, job.id, { enabled: false });
    expect(paused).toMatchObject({ enabled: false, nextRunAt: null });
    expect((await fetchJobStatuses(userId, project.id))[0].armed).toBe(false);

    const edited = await updateJob(userId, project.id, job.id, { enabled: true, schedule: "*/15 * * * *", command: "echo changed" });
    expect(edited).toMatchObject({ enabled: true, description: "Every 15 minutes", command: "echo changed" });
    expect((await fetchJobStatuses(userId, project.id))[0].armed).toBe(true);
    const { timer } = jobUnits(project.slug, job.id);
    expect(await sh(`grep OnCalendar ${unitDir}/${timer}`)).toContain(":00,15,30,45:00 UTC");

    await expect(updateJob(userId, project.id, job.id, { schedule: "* * * * *" })).rejects.toMatchObject({ status: 400 });
    expect((await listJobs(userId, project.id))[0].schedule).toBe("*/15 * * * *");
  });

  it("keeps jobs to the project's owner", async () => {
    const other = (await upsertUser({ id: "u2", name: "Alex", email: null, slackId: null })).id;
    const [job] = await listJobs(userId, project.id);
    await expect(listJobs(other, project.id)).rejects.toMatchObject({ status: 404 });
    await expect(createJob(other, project.id, nightly)).rejects.toMatchObject({ status: 404 });
    await expect(runJob(other, project.id, job.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteJob(other, project.id, job.id)).rejects.toMatchObject({ status: 404 });
    // A job id from another project is not found either.
    await expect(runJob(userId, idle.id, job.id)).rejects.toMatchObject({ status: 404 });
  });

  it("leaves a unit it did not write alone", async () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const { service } = jobUnits(project.slug, id);
    await sh(`printf '[Service]\\nExecStart=/bin/true\\n' > ${unitDir}/${service}`);
    const home = (await sh("echo $HOME")).trim();
    const script = installJob({
      home,
      slug: project.slug,
      jobId: id,
      unitDir,
      serviceFile: "x",
      timerFile: "y",
      enabled: true,
    });
    const s = await NestSession.connect({
      host: "127.0.0.1",
      port: mock.port,
      username: "sam-r",
      privateKey: open(server.privateKeyEnc, `server:${server.id}`),
    });
    try {
      const res = await s.script(script);
      expect(res.code).toBe(30);
      expect(res.stderr).toContain("was not created by Egg");
    } finally {
      s.close();
    }
    expect(await sh(`cat ${unitDir}/${service}`)).toContain("ExecStart=/bin/true");
    await sh(`rm -f ${unitDir}/${service}`);
  });

  it(`allows ${MAX_JOBS_PER_PROJECT} jobs per project`, async () => {
    let count = (await listJobs(userId, project.id)).length;
    while (count < MAX_JOBS_PER_PROJECT) {
      await createJob(userId, project.id, { name: `Extra ${count}`, schedule: "0 4 * * *", command: "true" });
      count++;
    }
    await expect(createJob(userId, project.id, nightly)).rejects.toMatchObject({ status: 409, code: "limit" });
  });

  it("removes a job from the container and the database", async () => {
    const jobs = await listJobs(userId, project.id);
    const gone = jobs[jobs.length - 1];
    await deleteJob(userId, project.id, gone.id);
    const { service, timer } = jobUnits(project.slug, gone.id);
    expect(await unitFiles()).not.toEqual(expect.arrayContaining([service]));
    expect(await unitFiles()).not.toEqual(expect.arrayContaining([timer]));
    expect((await listJobs(userId, project.id)).map((j) => j.id)).not.toContain(gone.id);
    await expect(deleteJob(userId, project.id, gone.id)).rejects.toMatchObject({ status: 404 });
  });

  it("removes every job's units when the project is removed from the server", async () => {
    const names = await jobUnitNames(project.id, project.slug);
    expect(names.length).toBeGreaterThan(0);
    // Timers come before their services, so no timer can start a job that is being removed.
    expect(names[0]).toMatch(/\.timer$/);
    expect(names[1]).toMatch(/\.service$/);
    expect(await unitFiles()).toEqual(expect.arrayContaining(names));

    await removeProjectFromServer(userId, project.id, { unitDir });
    const left = await unitFiles();
    for (const name of names) expect(left).not.toContain(name);
  });
});

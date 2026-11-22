import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSession, upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject, deployBranch } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import { MIN_FREE_DISK_MB } from "@/server/deploy/container-probe";
import { IMPORT_MAX_COPY_MB, confirmImport, copyRoomProblem, copyRoomScript, parseCopyRoom, planImport, removePartialCopyScript } from "@/server/adoption-import";

/** What the size and free-space script prints: about 100 MB to copy, about 9 GB free. */
const room = (srcMb: number, freeMb: number) => ({ code: 0, stdout: `SRC_KB	${srcMb * 1024}
FREE_KB	${freeMb * 1024}
`, stderr: "" });
const ROOM_OK = room(100, 9000);
/** Text only the bounded copy step of the cutover script contains. */
const COPY_MARK = "Copy is outside the project releases";

describe("import copy capacity", () => {
  it("rejects invalid or unrepresentable readings and preserves both byte and free-space limits", () => {
    expect(parseCopyRoom("SRC_KB\t9007199254740992\nFREE_KB\t999999999999999999999\n")).toBeNull();
    expect(parseCopyRoom("SRC_KB\t-1\nFREE_KB\t1000\n")).toBeNull();
    expect(copyRoomProblem(null)).not.toBeNull();
    const source = IMPORT_MAX_COPY_MB * 1024;
    const reserve = MIN_FREE_DISK_MB * 1024;
    expect(copyRoomProblem({ srcKb: source, freeKb: source + reserve })).toBeNull();
    expect(copyRoomProblem({ srcKb: source + 1, freeKb: source + reserve + 1000 })).not.toBeNull();
    expect(copyRoomProblem({ srcKb: 100, freeKb: reserve + 99 })).not.toBeNull();
  });
});

describe("controlled import planning", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let owner: string;
  let projectId: string;
  let candidateId: string;
  beforeAll(async () => {
    ctx = await useFreshDb();
    owner = (await upsertUser({ id: "adopt-import", name: "Owner", email: null, slackId: null })).id;
    const server = await createServer(owner, "adopt-import", { host: "127.0.0.1", port: 1 });
    const project = await createProject(owner, { serverId: server.id, name: "Import App", repoUrl: "https://github.com/example/app", runtime: "node", port: 3000 });
    projectId = project.id;
    const dep = await deployBranch(owner, project.id);
    candidateId = dep.id;
    await ctx.db.update(schema.deployments).set({ state: "ready", env: "preview", commitSha: "a".repeat(40), port: 3333 }).where(eq(schema.deployments.id, candidateId));
  });
  afterAll(async () => { await ctx.cleanup(); });
  const probe = () => ({ script: async () => ({ code: 0, stdout: `HOME\t/home/user\nWORK\t/home/user/app\nSHA\t${"a".repeat(40)}\nUNIT\t${"b".repeat(64)}\nPID\t123\nGROUP\t/system.slice/example.service\nENABLED\tenabled\n`, stderr: "" }), close() {} });
  it("stores an expiring encrypted plan without exposing credentials", async () => {
    const result = await planImport(owner, projectId, { unit: "example.service", candidateId }, async () => probe() as never);
    const row = await ctx.db.select().from(schema.adoptionPlans).where(eq(schema.adoptionPlans.id, result.id)).get();
    expect(row?.state).toBe("planned");
    expect(row?.payloadEnc).not.toContain("/home/user/app");
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBeLessThanOrEqual(600_000);
  });
  it("refuses a different checkout commit before storing a plan", async () => {
    await expect(planImport(owner, projectId, { unit: "example.service", candidateId }, async () => ({ ...probe(), script: async () => ({ code: 0, stdout: `HOME\t/home/user\nWORK\t/home/user/app\nSHA\t${"c".repeat(40)}\nUNIT\t${"b".repeat(64)}\nPID\t123\nGROUP\t/system.slice/example.service\nENABLED\tenabled\n`, stderr: "" }) }) as never)).rejects.toThrow(/commit/i);
  });
  it("never stops a service if the checkout changed after planning", async () => {
    const plan = await planImport(owner, projectId, { unit: "example.service", candidateId }, async () => probe() as never);
    await ctx.db.update(schema.jobs).set({ state: "done" }).where(eq(schema.jobs.deploymentId, candidateId));
    const token = (await createSession(owner, null, undefined, { freshHackClubAuth: true })).token;
    const scripts: string[] = [];
    const changed = { script: async (script: string) => {
      scripts.push(script);
      return { code: 0, stdout: `HOME\t/home/user\nWORK\t/home/user/app\nSHA\t${"c".repeat(40)}\nUNIT\t${"b".repeat(64)}\nPID\t123\nGROUP\t/system.slice/example.service\nENABLED\tenabled\n`, stderr: "" };
    }, close() {} };
    await expect(confirmImport(owner, projectId, plan.id, { confirm: true }, token, async () => changed as never)).rejects.toThrow(/changed/i);
    expect(scripts.some(script => script.includes('systemctl stop'))).toBe(false);
  });
  it("requires a fresh authenticated session before any remote mutation", async () => {
    const plan = await planImport(owner, projectId, { unit: "example.service", candidateId }, async () => probe() as never);
    const token = (await createSession(owner)).token;
    let connected = false;
    await expect(confirmImport(owner, projectId, plan.id, { confirm: true }, token, async () => { connected = true; return probe() as never; })).rejects.toMatchObject({ status: 403 });
    expect(connected).toBe(false);
  });
  it("restores the original service after a failed activation", async () => {
    const plan = await planImport(owner, projectId, { unit: "example.service", candidateId }, async () => probe() as never);
    const token = (await createSession(owner, null, undefined, { freshHackClubAuth: true })).token;
    const scripts: string[] = [];
    const session = { ...probe(), exec: async () => ({ code: 0, stdout: "", stderr: "" }), script: async (s: string) => {
      if (s.includes("du -skl")) return ROOM_OK;
      scripts.push(s);
      if (s.includes("git -C")) return (await probe().script());
      return { code: s.includes("ln -sfn") ? 1 : 0, stdout: "", stderr: "" };
    } };
    await expect(confirmImport(owner, projectId, plan.id, { confirm: true }, token, async () => session as never)).rejects.toThrow(/start/i);
    expect(scripts.some(s => s.includes("systemctl start 'example.service'"))).toBe(true);
    expect((await ctx.db.select().from(schema.adoptionPlans).where(eq(schema.adoptionPlans.id, plan.id)).get())!.state).toBe("failed");
  });
  it("rolls back if the original enabled service cannot be disabled for boot", async () => {
    const plan = await planImport(owner, projectId, { unit: "example.service", candidateId }, async () => probe() as never);
    const token = (await createSession(owner, null, undefined, { freshHackClubAuth: true })).token;
    let restoredBoot = false;
    const session = { ...probe(), exec: async () => ({ code: 0, stdout: "", stderr: "" }), script: async (s: string) => {
      if (s.includes("du -skl")) return ROOM_OK;
      if (s.includes("git -C")) return probe().script();
      if (s.includes("systemctl enable 'example.service'")) restoredBoot = true;
      return { code: s.includes("systemctl disable 'example.service'") ? 1 : 0, stdout: "", stderr: "" };
    } };
    await expect(confirmImport(owner, projectId, plan.id, { confirm: true }, token, async () => session as never)).rejects.toThrow(/boot/i);
    expect(restoredBoot).toBe(true);
    expect((await ctx.db.select().from(schema.adoptionPlans).where(eq(schema.adoptionPlans.id, plan.id)).get())!.state).toBe("failed");
  });
  it("creates a production deployment after a healthy cutover", async () => {
    const plan = await planImport(owner, projectId, { unit: "example.service", candidateId }, async () => probe() as never);
    const token = (await createSession(owner, null, undefined, { freshHackClubAuth: true })).token;
    const scripts: string[] = [];
    const session = { ...probe(), exec: async () => ({ code: 0, stdout: "", stderr: "" }), script: async (s: string) => {
      if (s.includes("du -skl")) return ROOM_OK;
      scripts.push(s);
      return s.includes("git -C") ? probe().script() : { code: 0, stdout: "", stderr: "" };
    } };
    await confirmImport(owner, projectId, plan.id, { confirm: true }, token, async () => session as never);
    await expect(confirmImport(owner, projectId, plan.id, { confirm: true }, token, async () => session as never)).rejects.toThrow(/already used|expired/i);
    expect(scripts.some(s => s.includes("systemctl stop 'example.service'"))).toBe(true);
    expect((await ctx.db.select().from(schema.adoptionPlans).where(eq(schema.adoptionPlans.id, plan.id)).get())!.state).toBe("completed");
    const prod = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.projectId, projectId));
    expect(prod.some(d => d.env === "production" && d.isCurrent && d.state === "ready")).toBe(true);
  });
  it("keeps the guard if rollback cannot confirm the original service is restored", async () => {
    const server = await createServer(owner, "adopt-other", { host: "127.0.0.1", port: 1 });
    const project = await createProject(owner, { serverId: server.id, name: "Import Other", repoUrl: "https://github.com/example/app", runtime: "node", port: 3000 });
    const candidate = await deployBranch(owner, project.id);
    await ctx.db.update(schema.deployments).set({ state: "ready", env: "preview", commitSha: "a".repeat(40), port: 3333 }).where(eq(schema.deployments.id, candidate.id));
    await ctx.db.update(schema.jobs).set({ state: "done" }).where(eq(schema.jobs.deploymentId, candidate.id));
    const plan = await planImport(owner, project.id, { unit: "example.service", candidateId: candidate.id }, async () => probe() as never);
    const token = (await createSession(owner, null, undefined, { freshHackClubAuth: true })).token;
    const session = { ...probe(), exec: async () => ({ code: 0, stdout: "", stderr: "" }), script: async (s: string) => {
      if (s.includes("du -skl")) return ROOM_OK;
      if (s.includes("git -C")) return probe().script();
      return { code: s.includes("ln -sfn") || s.includes("systemctl start 'example.service'") ? 1 : 0, stdout: "", stderr: "" };
    } };
    await expect(confirmImport(owner, project.id, plan.id, { confirm: true }, token, async () => session as never)).rejects.toThrow();
    expect((await ctx.db.select().from(schema.adoptionPlans).where(eq(schema.adoptionPlans.id, plan.id)).get())!.state).toBe("executing");
    expect(await ctx.db.select().from(schema.cleanupOperations).where(eq(schema.cleanupOperations.serverId, server.id))).toHaveLength(1);
  });
});


describe("import copy: disk space, size budget and partial copy cleanup", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let owner: string;
  let n = 0;
  beforeAll(async () => { ctx = await useFreshDb(); });
  afterAll(async () => { await ctx.cleanup(); });
  const original = () => `HOME\t/home/user\nWORK\t/home/user/app\nSHA\t${"a".repeat(40)}\nUNIT\t${"b".repeat(64)}\nPID\t123\nGROUP\t/system.slice/example.service\nENABLED\tenabled\n`;

  /** A project with a ready preview and a stored plan, each test on its own server so the guards never meet. */
  async function planned() {
    // One user each: a user may connect only a few servers.
    owner = (await upsertUser({ id: `adopt-room-${++n}`, name: "Owner", email: null, slackId: null })).id;
    const server = await createServer(owner, `adopt-room-${n}`, { host: "127.0.0.1", port: 1 });
    const project = await createProject(owner, { serverId: server.id, name: `Room ${n}`, repoUrl: "https://github.com/example/app", runtime: "node", port: 3000 });
    const candidate = await deployBranch(owner, project.id);
    await ctx.db.update(schema.deployments).set({ state: "ready", env: "preview", commitSha: "a".repeat(40), port: 3333 }).where(eq(schema.deployments.id, candidate.id));
    await ctx.db.update(schema.jobs).set({ state: "done" }).where(eq(schema.jobs.deploymentId, candidate.id));
    const planSession = { script: async () => ({ code: 0, stdout: original(), stderr: "" }), close() {} };
    const plan = await planImport(owner, project.id, { unit: "example.service", candidateId: candidate.id }, async () => planSession as never);
    const token = (await createSession(owner, null, undefined, { freshHackClubAuth: true })).token;
    return { server, project, plan, token };
  }

  type Reply = { code: number; stdout: string; stderr: string };
  /** A stand-in container: `handler` can answer for a script before the default (everything succeeds). */
  function container(handler: (s: string) => Reply | undefined) {
    const scripts: string[] = [];
    let execs = 0;
    const session = {
      close() {},
      exec: async () => { execs++; return { code: 0, stdout: "", stderr: "" }; },
      script: async (s: string): Promise<Reply> => {
        scripts.push(s);
        const custom = handler(s);
        if (custom) return custom;
        if (s.includes("du -skl")) return ROOM_OK;
        if (s.includes("git -C")) return { code: 0, stdout: original(), stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    return { session, scripts, execs: () => execs };
  }

  const stateOf = async (planId: string) => (await ctx.db.select().from(schema.adoptionPlans).where(eq(schema.adoptionPlans.id, planId)).get())!.state;
  const guards = async (serverId: string) => ctx.db.select().from(schema.cleanupOperations).where(eq(schema.cleanupOperations.serverId, serverId));
  const touchedNothing = (c: ReturnType<typeof container>) => {
    expect(c.scripts.some(s => s.includes(COPY_MARK))).toBe(false);
    expect(c.scripts.some(s => s.includes("systemctl stop"))).toBe(false);
    expect(c.scripts.some(s => s.includes("rm -rf"))).toBe(false);
    expect(c.execs()).toBe(0);
  };

  it("measures the size and free space before it copies, and copies when there is room", async () => {
    const { project, plan, token } = await planned();
    const c = container(() => undefined);
    await confirmImport(owner, project.id, plan.id, { confirm: true }, token, async () => c.session as never);
    const measured = c.scripts.findIndex(s => s.includes("du -skl") && s.includes("df -Pk"));
    const copied = c.scripts.findIndex(s => s.includes(COPY_MARK));
    const stopped = c.scripts.findIndex(s => s.includes("systemctl stop 'example.service'"));
    expect(measured).toBeGreaterThan(-1);
    expect(measured).toBeLessThan(copied);
    expect(copied).toBeLessThan(stopped);
    expect(c.scripts[copied]).toContain("timeout --kill-after=5 100 python3 -c");
    expect(await stateOf(plan.id)).toBe("completed");
  });

  it("refuses before copying when the copy would leave less free space than a deploy needs, and stops nothing", async () => {
    const { server, project, plan, token } = await planned();
    // 1000 MB to copy, 2500 MB free: 1500 MB would be left, under the 2048 MB margin.
    const c = container(s => (s.includes("du -skl") ? room(1000, 2500) : undefined));
    await expect(confirmImport(owner, project.id, plan.id, { confirm: true }, token, async () => c.session as never))
      .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Not enough free disk space.*needs 1000 MB.*1500 MB free.*2048 MB must stay free.*original service was not touched/) });
    touchedNothing(c);
    expect(await stateOf(plan.id)).toBe("failed");
    expect(await guards(server.id)).toHaveLength(0);
  });

  it("refuses a release over the size budget even when the disk is empty", async () => {
    const { server, project, plan, token } = await planned();
    const c = container(s => (s.includes("du -skl") ? room(IMPORT_MAX_COPY_MB + 1, 500_000) : undefined));
    await expect(confirmImport(owner, project.id, plan.id, { confirm: true }, token, async () => c.session as never))
      .rejects.toMatchObject({ status: 409, message: expect.stringMatching(new RegExp(`over the ${IMPORT_MAX_COPY_MB} MB the import will copy`)) });
    touchedNothing(c);
    expect(await stateOf(plan.id)).toBe("failed");
    expect(await guards(server.id)).toHaveLength(0);
  });

  it("refuses when the size or the free space cannot be measured", async () => {
    const { project, plan, token } = await planned();
    const c = container(s => (s.includes("du -skl") ? { code: 51, stdout: "", stderr: "" } : undefined));
    await expect(confirmImport(owner, project.id, plan.id, { confirm: true }, token, async () => c.session as never))
      .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Could not measure/) });
    touchedNothing(c);
    expect(await stateOf(plan.id)).toBe("failed");
  });

  it("removes the partial copy when the copy times out, leaves the original running and releases the guard", async () => {
    const { server, project, plan, token } = await planned();
    const c = container(s => { if (s.includes(COPY_MARK)) throw new Error("Command timed out after 120s"); return undefined; });
    await expect(confirmImport(owner, project.id, plan.id, { confirm: true }, token, async () => c.session as never))
      .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/partial copy was removed.*original service was not touched/) });
    const copied = c.scripts.findIndex(s => s.includes(COPY_MARK));
    const cleaned = c.scripts.findIndex(s => s.includes("rm -rf"));
    expect(cleaned).toBeGreaterThan(copied);
    expect(c.scripts.some(s => s.includes("systemctl stop"))).toBe(false);
    expect(c.execs()).toBe(0);
    expect(await stateOf(plan.id)).toBe("failed");
    expect(await guards(server.id)).toHaveLength(0);
  });

  it("removes the partial copy when the copy command fails", async () => {
    const { project, plan, token } = await planned();
    const c = container(s => (s.includes(COPY_MARK) ? { code: 1, stdout: "", stderr: "No space left on device" } : undefined));
    await expect(confirmImport(owner, project.id, plan.id, { confirm: true }, token, async () => c.session as never)).rejects.toThrow(/partial copy was removed/);
    expect(c.scripts.some(s => s.includes("rm -rf"))).toBe(true);
    expect(c.scripts.some(s => s.includes("systemctl stop"))).toBe(false);
    expect(await stateOf(plan.id)).toBe("failed");
  });

  it("keeps the guard when the partial copy cannot be confirmed removed", async () => {
    const { server, project, plan, token } = await planned();
    const c = container(s => {
      if (s.includes(COPY_MARK)) throw new Error("Command timed out after 120s");
      if (s.includes("rm -rf")) return { code: 1, stdout: "", stderr: "" };
      return undefined;
    });
    await expect(confirmImport(owner, project.id, plan.id, { confirm: true }, token, async () => c.session as never)).rejects.toThrow(/guard remains in place/);
    expect(c.scripts.some(s => s.includes("systemctl stop"))).toBe(false);
    expect(await stateOf(plan.id)).toBe("executing");
    expect(await guards(server.id)).toHaveLength(1);
  });

  it("removes the copied production release on a failed cutover and releases the guard", async () => {
    const { server, project, plan, token } = await planned();
    // The stop confirmation fails after the copy succeeded, so the rollback runs.
    const c = container(s => (s.includes("systemctl stop 'example.service'") ? { code: 1, stdout: "", stderr: "" } : undefined));
    await expect(confirmImport(owner, project.id, plan.id, { confirm: true }, token, async () => c.session as never))
      .rejects.toThrow(/could not be confirmed stopped/i);
    const copied = c.scripts.findIndex(s => s.includes(COPY_MARK));
    const back = c.scripts.find(s => s.includes('rm -rf -- "$dst"'));
    expect(copied).toBeGreaterThan(-1);
    expect(back).toBeDefined();
    // The removal is in the rollback script itself, after the original service was restarted.
    expect(back).toContain("systemctl start 'example.service'");
    expect(back!.indexOf("systemctl start 'example.service'")).toBeLessThan(back!.indexOf('rm -rf -- "$dst"'));
    expect(await stateOf(plan.id)).toBe("failed");
    expect(await guards(server.id)).toHaveLength(0);
  });

  it("keeps the guard when the copied production release cannot be confirmed removed", async () => {
    const { server, project, plan, token } = await planned();
    const c = container(s => {
      if (s.includes("systemctl stop 'example.service'")) return { code: 1, stdout: "", stderr: "" };
      if (s.includes('rm -rf -- "$dst"')) return { code: 1, stdout: "", stderr: "" };
      return undefined;
    });
    await expect(confirmImport(owner, project.id, plan.id, { confirm: true }, token, async () => c.session as never)).rejects.toThrow();
    expect(c.scripts.some(s => s.includes('rm -rf -- "$dst"'))).toBe(true);
    expect(await stateOf(plan.id)).toBe("executing");
    expect(await guards(server.id)).toHaveLength(1);
  });
});

describe("import copy: the checks themselves", () => {
  it("allows a copy that leaves exactly the deploy margin and refuses one MB less", () => {
    const edge = (freeMb: number) => ({ srcKb: 500 * 1024, freeKb: freeMb * 1024 });
    expect(copyRoomProblem(edge(500 + MIN_FREE_DISK_MB))).toBeNull();
    expect(copyRoomProblem(edge(500 + MIN_FREE_DISK_MB - 1))).toMatch(/Not enough free disk space/);
  });

  it("allows a release exactly at the size budget and refuses one MB over", () => {
    const big = (mb: number) => ({ srcKb: mb * 1024, freeKb: 1_000_000 * 1024 });
    expect(copyRoomProblem(big(IMPORT_MAX_COPY_MB))).toBeNull();
    expect(copyRoomProblem(big(IMPORT_MAX_COPY_MB + 1))).toMatch(/over the 2048 MB/);
  });

  it("says how much would be left, never a negative number", () => {
    expect(copyRoomProblem({ srcKb: 10 * 1024, freeKb: 100 * 1024 })).toMatch(/would leave 90 MB free/);
    expect(copyRoomProblem({ srcKb: 200 * 1024, freeKb: 100 * 1024 })).toMatch(/would leave 0 MB free/);
  });

  it("reads the measurements and rejects anything it cannot read", () => {
    expect(parseCopyRoom("SRC_KB\t10\nFREE_KB\t20\n")).toEqual({ srcKb: 10, freeKb: 20 });
    expect(parseCopyRoom("")).toBeNull();
    expect(parseCopyRoom("SRC_KB\tabc\nFREE_KB\t20\n")).toBeNull();
    expect(parseCopyRoom("SRC_KB\t10\n")).toBeNull();
  });

  it("measures with a time limit, counts hard links like the copy does, and changes nothing", () => {
    const script = copyRoomScript("/home/u/.egg/app/releases/a", "/home/u/.egg/app");
    expect(script).toContain("timeout 60 du -skl --");
    expect(script).toContain("df -Pk --");
    expect(script).not.toMatch(/\b(rm|cp|mv|systemctl)\b/);
  });

  it("removes only a release folder inside the project's own releases folder", () => {
    const script = removePartialCopyScript("/home/u/.egg/app", "/home/u/.egg/app/releases/x");
    expect(script).toContain('case "$dst" in "$base"/releases/?*)');
    expect(script).toContain(".egg-managed");
    expect(script).toContain('rm -rf -- "$dst"');
  });
});

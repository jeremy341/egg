import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { runPostDeployChecks } from "@/server/deploy-regression-job";
import { parseStoredCheck } from "@/server/deploy-regression";
import { createProject, type ProjectRow } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let serverId: string;
let port = 3900;
let seq = 0;

const MIN = 60_000;

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "regress-owner", name: "Regress Owner", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "regress-server")).id;
});

afterAll(async () => {
  await ctx.cleanup();
});

async function project(name: string): Promise<ProjectRow> {
  return createProject(userId, {
    serverId,
    name,
    repoUrl: "https://github.com/example/demo",
    runtime: "node",
    startCommand: "node server.js",
    port: port++,
  });
}

/** A ready production deploy that became ready `minutesAgo` minutes before `now`. */
async function readyDeploy(p: ProjectRow, readyAt: Date) {
  const db = await getDb();
  const id = `regress-dep-${seq++}`;
  await db.insert(schema.deployments).values({
    id,
    projectId: p.id,
    env: "production",
    state: "ready",
    source: "manual",
    branch: "main",
    port: p.port,
    releaseId: `rel-${id}`,
    isCurrent: true,
    createdAt: new Date(readyAt.getTime() - 5 * MIN),
    startedAt: new Date(readyAt.getTime() - 4 * MIN),
    finishedAt: readyAt,
  });
  return id;
}

/** One health check per minute from `from` (minutes relative to ready) to `to`. */
async function checks(p: ProjectRow, readyAt: Date, from: number, to: number, healthMs: number, healthOk = true) {
  const db = await getDb();
  const rows = [];
  for (let m = from; m <= to; m++) {
    rows.push({
      projectId: p.id,
      at: new Date(readyAt.getTime() + m * MIN),
      memMb: 50,
      cpuNs: 1,
      cpuPercent: 1,
      restarts: 0,
      healthMs,
      healthOk,
    });
  }
  await db.insert(schema.projectSamples).values(rows);
}

async function trailingDeploy(depId: string) {
  const db = await getDb();
  return db.select().from(schema.deployments).where(eq(schema.deployments.id, depId)).get();
}

describe("runPostDeployChecks", () => {
  it("records a regression and writes a deploy alert when the app slowed down after the deploy", async () => {
    const p = await project("slowed");
    const readyAt = new Date("2026-03-01T10:00:00Z");
    const depId = await readyDeploy(p, readyAt);
    await checks(p, readyAt, -15, -1, 100);
    await checks(p, readyAt, 1, 15, 400);

    const now = new Date(readyAt.getTime() + 16 * MIN);
    expect(await runPostDeployChecks(now)).toBe(1);

    const dep = await trailingDeploy(depId);
    const stored = parseStoredCheck(dep!.postDeployCheck);
    expect(stored?.verdict).toBe("regressed");
    expect(stored?.reasons[0]).toContain("P95 latency rose from 100 ms to 400 ms");

    const db = await getDb();
    const alerts = await db
      .select()
      .from(schema.alertEvents)
      .where(and(eq(schema.alertEvents.projectId, p.id), eq(schema.alertEvents.type, "deploy")));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("slower or less reliable since a deploy");
  });

  it("records ok without raising an alert when the numbers hold", async () => {
    const p = await project("steady");
    const readyAt = new Date("2026-03-02T10:00:00Z");
    const depId = await readyDeploy(p, readyAt);
    await checks(p, readyAt, -15, -1, 100);
    await checks(p, readyAt, 1, 15, 105);

    await runPostDeployChecks(new Date(readyAt.getTime() + 16 * MIN));
    expect(parseStoredCheck((await trailingDeploy(depId))!.postDeployCheck)?.verdict).toBe("ok");
    const db = await getDb();
    expect(await db.select().from(schema.alertEvents).where(eq(schema.alertEvents.projectId, p.id))).toHaveLength(0);
  });

  it("waits until 15 minutes after the deploy before comparing", async () => {
    const p = await project("too-early");
    const readyAt = new Date("2026-03-03T10:00:00Z");
    const depId = await readyDeploy(p, readyAt);
    await checks(p, readyAt, -15, -1, 100);
    await checks(p, readyAt, 1, 5, 400);

    expect(await runPostDeployChecks(new Date(readyAt.getTime() + 10 * MIN))).toBe(0);
    expect((await trailingDeploy(depId))!.postDeployCheck).toBeNull();
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Principal } from "@/server/api-tokens";
import { apiGetCrashReport, apiListCrashReports } from "@/server/api-v1-crash-reports";
import { getDb, schema } from "@/server/db";
import { seal } from "@/server/crypto";
import { captureFailedUnit } from "@/server/crash-reports";
import { parseServiceStatus } from "@/server/service-status";
import { createServer } from "@/server/servers";
import { upsertUser } from "@/server/auth/session";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let ownerId: string;
let otherUserId: string;
let serverId: string;
let projectSequence = 0;
let reader: Principal;
let unscoped: Principal;

beforeAll(async () => {
  ctx = await useFreshDb();
  ownerId = (await upsertUser({ id: "crash-report-owner", name: "Owner", email: null, slackId: null })).id;
  otherUserId = (await upsertUser({ id: "crash-report-other", name: "Other", email: null, slackId: null })).id;
  reader = { userId: ownerId, tokenId: "token", scopes: ["logs:read"] };
  unscoped = { userId: ownerId, tokenId: "token", scopes: ["projects:read"] };
  serverId = (await createServer(ownerId, "crash-report-server")).id;
});

afterAll(async () => {
  await ctx?.cleanup();
});

async function makeProject() {
  const db = await getDb();
  const id = `crash-project-${++projectSequence}`;
  const now = new Date();
  await db.insert(schema.projects).values({
    id,
    userId: ownerId,
    serverId,
    slug: `crash-project-${projectSequence}`,
    name: `Crash project ${projectSequence}`,
    repoUrl: "https://github.com/example/crash-project",
    runtime: "node",
    port: 3000 + projectSequence,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("crash report identity", () => {
  it("keeps the systemd invocation id used to deduplicate one crash", () => {
    const invocationId = "b9c46f196d594367a2aebfd2a2cdd5ca";
    const status = parseServiceStatus([
      "EGG_LoadState=loaded",
      "EGG_ActiveState=failed",
      `EGG_InvocationID=${invocationId}`,
    ].join("\n"));

    expect(status.invocationId).toBe(invocationId);
  });
});

describe("crash report capture and reads", () => {
  it("captures each failed unit invocation once and masks stored journal secrets", async () => {
    const db = await getDb();
    const projectId = await makeProject();
    const secret = "planted-crash-secret-6428";
    await db.insert(schema.envVars).values({
      id: "crash-secret",
      projectId,
      key: "SERVICE_TOKEN",
      valueEnc: seal(secret, `env:${projectId}:SERVICE_TOKEN:production`),
      target: "production",
      createdAt: new Date(),
    });
    const stdout = [
      ...Array.from({ length: 204 }, (_, index) => `journal-${index}`),
      `password=${secret}`,
      "",
    ].join("\n");
    const script = vi.fn(async (_script: string) => ({ code: 0, stdout, stderr: "" }));
    const status = (invocationId: string) => parseServiceStatus([
      "EGG_LoadState=loaded",
      "EGG_ActiveState=failed",
      "EGG_Result=exit-code",
      "EGG_ExecMainStatus=1",
      "EGG_NRestarts=5",
      `EGG_InvocationID=${invocationId}`,
    ].join("\n"));
    const args = {
      projectId,
      releaseId: "release-current",
      unit: "egg-crash-project.service",
      session: { script } as never,
      at: new Date("2026-11-25T12:00:00.000Z"),
    };

    await expect(captureFailedUnit({ ...args, status: status("invocation-one") })).resolves.toBe(true);
    await expect(captureFailedUnit({ ...args, status: status("invocation-one") })).resolves.toBe(false);
    await expect(captureFailedUnit({ ...args, status: status("invocation-two") })).resolves.toBe(true);

    expect(script).toHaveBeenCalledTimes(2);
    expect(script.mock.calls[0][0]).toContain("-n 200");
    const reports = await db.select().from(schema.crashReports).where(eq(schema.crashReports.projectId, projectId));
    expect(reports).toHaveLength(2);
    expect(reports[0].releaseId).toBe("release-current");
    expect(reports[0].capturedLines.split("\n")).toHaveLength(200);
    expect(reports[0].capturedLines).not.toContain(secret);
    expect(reports[0].capturedLines).toContain("password=***");
  });

  it("checks logs:read before looking up a project", async () => {
    await expect(apiListCrashReports(unscoped, "not-owned", 20)).rejects.toMatchObject({ status: 403 });
  });

  it("returns 404 for reports and projects the caller does not own", async () => {
    const db = await getDb();
    const projectId = await makeProject();
    await db.insert(schema.crashReports).values({
      id: "owned-crash-report",
      projectId,
      releaseId: "release-1",
      createdAt: new Date(),
      reason: "exit-code",
      capturedLines: "last line",
    });
    const other: Principal = { userId: otherUserId, tokenId: "token-other", scopes: ["logs:read"] };
    await expect(apiListCrashReports(other, projectId, 20)).rejects.toMatchObject({ status: 404 });
    await expect(apiGetCrashReport(other, "owned-crash-report")).rejects.toMatchObject({ status: 404 });
    await expect(apiGetCrashReport(reader, "missing-crash-report")).rejects.toMatchObject({ status: 404 });
  });

  it("returns the newest bounded list page and caps report detail at 40 KB", async () => {
    const db = await getDb();
    const projectId = await makeProject();
    const start = Date.parse("2026-11-25T10:00:00.000Z");
    await db.insert(schema.crashReports).values(Array.from({ length: 5 }, (_, index) => ({
      id: `bounded-report-${index}`,
      projectId,
      releaseId: `release-${index}`,
      createdAt: new Date(start + index * 1000),
      reason: "exit-code",
      capturedLines: "x".repeat(100_000),
    })));

    const page = await apiListCrashReports(reader, projectId, 2);
    expect(page.reports.map((report) => report.id)).toEqual(["bounded-report-4", "bounded-report-3"]);
    expect(page.more).toBe(true);

    const detail = await apiGetCrashReport(reader, "bounded-report-4");
    expect(detail.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(detail), "utf8")).toBeLessThanOrEqual(40 * 1024);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { upsertUser } from "@/server/auth/session";
import { DeploymentLogger } from "@/server/deploy/logger";
import { runProcess } from "@/server/deploy/build";
import { createProject, deployBranch } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let deploymentId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  const user = await upsertUser({ id: "edge-log", name: "Edge", email: null, slackId: null });
  const server = await createServer(user.id, "edge-log");
  const project = await createProject(user.id, {
    serverId: server.id,
    name: "Log App",
    repoUrl: "https://github.com/example/log",
    runtime: "node",
    port: 3100,
  });
  deploymentId = (await deployBranch(user.id, project.id)).id;
});

afterAll(async () => {
  await ctx.cleanup();
});

const stored = async (id = deploymentId) =>
  ctx.db.select().from(schema.deploymentLogs).where(eq(schema.deploymentLogs.deploymentId, id));

describe("deployment log edge cases", () => {
  it("a log write that fails (the deployment was deleted mid-build) must not crash the process", async () => {
    // Deleting a project, server or account while a deploy runs removes the deployment row; the
    // logger's timer-driven flush then fails its insert. That rejection has to be handled.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const orphan = new DeploymentLogger("deployment-that-no-longer-exists", 10);
      orphan.info("still building after the project was deleted");
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it("keeps a runaway build from writing an unbounded number of log rows", async () => {
    const log = new DeploymentLogger(deploymentId, 5);
    for (let i = 0; i < 25_000; i++) log.info(`line ${i}`);
    await log.flush();
    expect((await stored()).length).toBeLessThanOrEqual(20_000);
  }, 60_000);

  it("does not store terminal control sequences or NUL bytes from build output", async () => {
    const log = new DeploymentLogger(deploymentId, 5);
    log.info("\u001b[31mred\u001b[0m and a nul\u0000byte");
    await log.flush();
    const row = (await stored()).find((r) => r.message.includes("red"));
    expect(row?.message).toBeDefined();
    expect(row!.message).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
  });
});

describe("build output decoding", () => {
  it("keeps a multi-byte character intact when it straddles two pipe chunks", async () => {
    // 70,000 three-byte characters in one write: the pipe hands them over in 64 KiB pieces, and
    // 65,536 is not a multiple of 3, so one character is split across two chunks.
    const lines: string[] = [];
    const code = await runProcess(
      process.execPath,
      ["-e", "process.stdout.write(String.fromCharCode(8364).repeat(70000))"],
      { onLine: (l) => lines.push(l) }
    );
    expect(code).toBe(0);
    const text = lines.join("");
    // A split character is decoded as two U+FFFD replacement characters instead of one euro sign.
    expect(text.split(String.fromCharCode(0xfffd)).length - 1).toBe(0);
    expect(text.length).toBe(70000);
  });
});

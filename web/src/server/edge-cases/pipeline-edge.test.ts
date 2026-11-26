import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { open } from "@/server/crypto";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { runDeployJob, type PipelineDeps } from "@/server/deploy/pipeline";
import { createProject, deployBranch, type ProjectRow } from "@/server/projects";
import { connectToServer, createServer, getServerForUser, type ServerRow } from "@/server/servers";
import { NestSession } from "@/server/ssh/connection";
import { brokenApp, fakeBuilder, freePort, installFakeSystemd, nodeApp, type FixtureFiles } from "@/server/test/fake-nest";
import { useFreshDb } from "@/server/test/db";
import { startMockSsh, type MockSsh } from "@/server/test/mock-ssh";

// Same harness as deploy/pipeline.test.ts: the real pipeline against a mock Nest container.
let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let mock: MockSsh;
let userId: string;
let server: ServerRow;
let project: ProjectRow;
let deps: PipelineDeps;
let files: FixtureFiles = nodeApp("v1");

async function sh(command: string) {
  const s = await NestSession.connect({
    host: "127.0.0.1",
    port: mock.port,
    username: "edge-nest",
    privateKey: open(server.privateKeyEnc, `server:${server.id}`),
  });
  try {
    return (await s.exec(command)).stdout.trim();
  } finally {
    s.close();
  }
}

const row = (id: string) =>
  ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, id)).get() as Promise<
    typeof schema.deployments.$inferSelect
  >;

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "edge-pipe", name: "Pipe", email: null, slackId: null })).id;
  server = await createServer(userId, "edge-nest", { host: "127.0.0.1", port: 1 });
  mock = await startMockSsh({ authorizedKeys: [server.publicKey] });
  installFakeSystemd(mock);
  await ctx.db.update(schema.servers).set({ port: mock.port }).where(eq(schema.servers.id, server.id));
  server = await getServerForUser(userId, server.id);

  project = await createProject(userId, {
    serverId: server.id,
    name: "Edge App",
    repoUrl: "https://github.com/example/edge",
    runtime: "node",
    startCommand: "node server.js",
    port: await freePort(),
    healthPath: "/",
  });
  deps = {
    build: fakeBuilder(() => files),
    connect: connectToServer,
    unitDir: `${mock.home.split(String.fromCharCode(92)).join("/")}/units`,
    healthTimeoutSeconds: 8,
  };
});

afterAll(async () => {
  for (const unit of (await sh("ls $HOME/units 2>/dev/null || true")).split(/\s+/).filter(Boolean)) {
    await sh(`systemctl stop ${unit}`).catch(() => {});
  }
  await mock.stop();
  await ctx.cleanup();
});

describe("a cancel that arrives after the release switch", () => {
  it("does not leave a canceled deployment marked as the live release", async () => {
    files = nodeApp("switched");
    const dep = await deployBranch(userId, project.id, "main");
    const cancelAfterSwitch: PipelineDeps = {
      ...deps,
      connect: async (srv) => {
        const session = await deps.connect(srv);
        return new Proxy(session, {
          get(target, prop) {
            const value = Reflect.get(target, prop, target);
            if (prop !== "script") return typeof value === "function" ? value.bind(target) : value;
            return async (script: string, opts?: unknown) => {
              const result = await target.script(script, opts as never);
              // The "Switching the release" step has just finished; now the cancel button is pressed.
              if (script.includes("mv -Tf")) {
                await ctx.db.update(schema.deployments).set({ state: "canceled" }).where(eq(schema.deployments.id, dep.id));
              }
              return result;
            };
          },
        });
      },
    };

    await runDeployJob(dep.id, cancelAfterSwitch);

    const after = await row(dep.id);
    // Whatever the right outcome is (finish as ready, or revert), these two cannot both be true.
    expect(after.state === "canceled" && after.isCurrent).toBe(false);
  }, 60_000);
});

describe("a preview that fails its health check", () => {
  it("is stopped and its service file removed, not left restarting forever", async () => {
    files = brokenApp();
    const dep = await deployBranch(userId, project.id, "feature/broken");
    await runDeployJob(dep.id, deps);

    const after = await row(dep.id);
    expect(after.state).toBe("error");
    const unit = `egg-edge-app-pv-${after.releaseId.slice(0, 8)}.service`;
    const left = (await sh("ls $HOME/units")).split(/\s+/);
    expect(left).not.toContain(unit);
  }, 60_000);
});

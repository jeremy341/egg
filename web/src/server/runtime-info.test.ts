import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { fetchRuntimeLogs } from "@/server/runtime-info";
import { createServer } from "@/server/servers";
import { freePort } from "@/server/test/fake-nest";
import { useFreshDb } from "@/server/test/db";

describe("fetchRuntimeLogs when the container cannot be reached", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    ctx = await useFreshDb();
    userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
    // Nothing listens on port 1, so the SSH connection is refused.
    const server = await createServer(userId, "sam-r", { host: "127.0.0.1", port: 1 });
    await ctx.db.update(schema.servers).set({ hostKeyFingerprint: "SHA256:" + "A".repeat(43) }).where(eq(schema.servers.id, server.id));
    projectId = (
      await createProject(userId, {
        serverId: server.id,
        repoUrl: "https://github.com/example/demo",
        runtime: "node",
        name: "Logs App",
        startCommand: "node server.js",
        port: await freePort(),
      })
    ).id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("answers 502 upstream with a plain message, not a 500", async () => {
    const err = await fetchRuntimeLogs(userId, projectId).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: "upstream" });
    const message = (err as Error).message;
    // The raw socket error stays out of what the person reads.
    expect(message).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|SSH error/i);
    expect(message).toMatch(/logs/i);
  });
});

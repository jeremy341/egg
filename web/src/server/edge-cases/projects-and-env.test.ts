import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { addDomain } from "@/server/domains";
import { upsertUser } from "@/server/auth/session";
import { renderEnvFile } from "@/server/deploy/runtime";
import { schema } from "@/server/db";
import { createProject, updateProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;

beforeAll(async () => {
  ctx = await useFreshDb();
});

afterAll(async () => {
  await ctx.cleanup();
});

const input = (serverId: string, name: string, port: number) => ({
  serverId,
  name,
  repoUrl: `https://github.com/example/${name}`,
  runtime: "node" as const,
  port,
});

describe("two projects asking for the same port at the same moment", () => {
  it("lets only one of them have it", async () => {
    const user = await upsertUser({ id: "edge-race", name: "Racer", email: null, slackId: null });
    const server = await createServer(user.id, "edge-race");

    const results = await Promise.allSettled([
      createProject(user.id, input(server.id, "first", 3400)),
      createProject(user.id, input(server.id, "second", 3400)),
    ]);

    const onPort = await ctx.db.select().from(schema.projects).where(eq(schema.projects.serverId, server.id));
    expect(onPort.filter((p) => p.port === 3400)).toHaveLength(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("changing a project's port", () => {
  it("marks the project's domains as needing the new port in the Nest dashboard", async () => {
    const user = await upsertUser({ id: "edge-port", name: "Porter", email: null, slackId: null });
    const server = await createServer(user.id, "edge-port");
    const project = await createProject(user.id, input(server.id, "ported", 3401));
    const { domain } = await addDomain(user.id, {
      serverId: server.id,
      projectId: project.id,
      domain: "ported.example.com",
      port: 3401,
    });
    await ctx.db.update(schema.domains).set({ status: "valid" }).where(eq(schema.domains.id, domain.id));

    await updateProject(user.id, project.id, { port: 3402 });

    const after = await ctx.db.select().from(schema.domains).where(eq(schema.domains.id, domain.id)).get();
    // The domain still maps to 3401 in Nest and nothing says so: it must follow the project and go back to pending.
    expect(after?.port).toBe(3402);
    expect(after?.status).toBe("pending");
  });
});

describe("environment file rendering", () => {
  it("never writes a bare carriage return, which systemd reads as the end of the line", () => {
    const file = renderEnvFile({ NOTE: "first\rPATH=/tmp/evil" });
    // systemd treats both \n and \r as line ends, so a raw \r would start a new KEY=value line.
    expect(file).not.toContain("\r");
    expect(file.split("\n").filter(Boolean)).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { createProject, createProjectInput, projectResponse, updateProjectInput } from "@/server/projects";
import { serviceStatus, unitFile } from "@/server/deploy/remote";
import { useFreshDb } from "@/server/test/db";
import { upsertUser } from "@/server/auth/session";
import { createServer } from "@/server/servers";

const base = { serverId: "s", name: "App", repoUrl: "https://github.com/a/b", runtime: "node" };
describe("workload contract", () => {
  it("defaults existing web projects to native mode", () => {
    expect(createProjectInput.parse({ ...base, port: 3000 })).toMatchObject({ workloadKind: "web", deploymentMode: "native" });
    expect(updateProjectInput.parse({ name: "Renamed" })).not.toHaveProperty("workloadKind");
  });
  it("accepts a worker without an HTTP port", () => {
    expect(createProjectInput.safeParse({ ...base, workloadKind: "worker" }).success).toBe(true);
  });
  it("omits listener configuration and HTTP probing for a worker", () => {
    expect(unitFile({ slug: "worker", description: "worker", workDir: "/tmp", envFile: "/tmp/env", port: null, startCommand: "node worker.js" })).not.toContain("Environment=PORT=");
    expect(serviceStatus({ unit: "egg-worker.service", port: null, path: "/" })).not.toContain("curl");
  });
  it("persists workers without a public port and rejects unwired container deployments", async () => {
    const ctx = await useFreshDb();
    try {
      const user = await upsertUser({ id: "worker-user", name: "User", email: null, slackId: null });
      const server = await createServer(user.id, "worker-user");
      const worker = await createProject(user.id, { ...base, serverId: server.id, workloadKind: "worker" });
      expect(projectResponse(worker)).toMatchObject({ port: null, listenPort: null, healthPath: null });
      await expect(createProject(user.id, { ...base, serverId: server.id, workloadKind: "worker", deploymentMode: "dockerfile" })).rejects.toThrow("A Dockerfile project needs the Dockerfile path.");
    } finally { await ctx.cleanup(); }
  });
});

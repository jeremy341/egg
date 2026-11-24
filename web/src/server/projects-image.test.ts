import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { createProject, enqueueDeployment, updateProject, type ProjectRow } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let serverId: string;

const base = {
  repoUrl: "https://github.com/example/image-app",
  runtime: "node" as const,
  startCommand: "node server.js",
};

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "image-owner", name: "Owner", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "image-server")).id;
});

afterAll(async () => {
  await ctx.cleanup();
});

// Each app on a server needs its own listen port, so helper apps take the next free port from 9000.
let nextPort = 9000;
function image(name: string, extra: Record<string, unknown> = {}) {
  return createProject(userId, { serverId, name, deploymentMode: "image", imageRef: "nginx:1.27", repoUrl: "", port: nextPort++, ...extra });
}

async function rejects(promise: Promise<unknown>, pattern: RegExp) {
  await expect(promise).rejects.toThrow(pattern);
}

describe("image apps: create and reference checks", () => {
  it("creates an image app with port 80, auto pull, and no auto deploy", async () => {
    const p: ProjectRow = await createProject(userId, { serverId, name: "Image Default", deploymentMode: "image", imageRef: "nginx:1.27", repoUrl: "" });
    expect(p.deploymentMode).toBe("image");
    expect(p.imageRef).toBe("nginx:1.27");
    expect(p.port).toBe(80);
    expect(p.containerPort).toBe(80);
    expect(p.pullPolicy).toBe("auto");
    expect(p.autoDeploy).toBe(false);
  });

  it("keeps a port the user chose", async () => {
    const p = await image("Image Port", { port: 8080 });
    expect(p.port).toBe(8080);
  });

  it("refuses a missing image reference", async () => {
    await rejects(createProject(userId, { serverId, name: "No Ref", deploymentMode: "image", repoUrl: "" }), /needs an image reference/);
  });

  it("refuses a malformed reference and a bad registry host", async () => {
    await rejects(image("Bad Ref", { imageRef: "ghcr.io/Owner/app" }), /lowercase/);
    await rejects(image("Bad Host", { imageRef: "https://ghcr.io/owner/app" }), /no spaces and no scheme/);
  });

  it("refuses a source port below 1024, while an image app may use any port it names", async () => {
    await rejects(createProject(userId, { ...base, serverId, name: "Low Port", port: 80 }), /Ports below 1024/);
    const p = await createProject(userId, { serverId, name: "Image Low", deploymentMode: "image", imageRef: "nginx:1.27", repoUrl: "", port: 8088 });
    expect(p.port).toBe(8088);
  });
});

describe("pull policy is stored per app", () => {
  it("stores the policy chosen at create time", async () => {
    expect((await image("Always Pull", { pullPolicy: "always" })).pullPolicy).toBe("always");
    expect((await image("Cached Pull", { pullPolicy: "cached" })).pullPolicy).toBe("cached");
  });

  it("stores a change on update and keeps it on a later unrelated update", async () => {
    const p = await image("Pull Change");
    const changed = await updateProject(userId, p.id, { pullPolicy: "always" });
    expect(changed.pullPolicy).toBe("always");
    const renamed = await updateProject(userId, p.id, { name: "Pull Change Renamed" });
    expect(renamed.pullPolicy).toBe("always");
  });

  it("refuses a pull policy on a source app", async () => {
    await rejects(createProject(userId, { ...base, serverId, name: "Source Pull", port: 3801, pullPolicy: "always" }), /apply only to image apps/);
    const src = await createProject(userId, { ...base, serverId, name: "Source Pull Ok", port: 3802 });
    await rejects(updateProject(userId, src.id, { pullPolicy: "always" }), /apply only to image apps/);
  });
});

describe("image apps: update and deploy", () => {
  it("changes the reference through update and checks it", async () => {
    const p = await image("Ref Change");
    const updated = await updateProject(userId, p.id, { imageRef: "ghcr.io/owner/app:2.0.0" });
    expect(updated.imageRef).toBe("ghcr.io/owner/app:2.0.0");
    await rejects(updateProject(userId, p.id, { imageRef: "ghcr.io/owner/APP" }), /lowercase/);
  });

  it("refuses auto deploy for an image app", async () => {
    const p = await image("No Auto");
    await rejects(updateProject(userId, p.id, { autoDeploy: true }), /no push to watch/);
  });

  it("does not queue a deployment for an image app yet", async () => {
    const p = await image("Queue Refused");
    await rejects(enqueueDeployment(p, { env: "production", source: "manual", branch: "main" }), /not available yet/);
  });
});

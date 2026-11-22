import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

// Session auth is replaced; the rest of the route (and the real DB) stays intact.
const auth = vi.hoisted(() => ({ user: "" as string }));
vi.mock("@/server/http", async (orig) => ({
  ...(await orig<typeof import("@/server/http")>()),
  authed: async () => ({ id: auth.user }),
}));

import { GET } from "@/app/api/projects/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let viewerId: string;
let ownedProjectId: string;
let sharedProjectId: string;

const base = {
  repoUrl: "https://github.com/example/demo",
  runtime: "node" as const,
  startCommand: "node server.js",
};

const call = () => GET(new NextRequest("http://localhost:3000/api/projects"), {} as never);

beforeAll(async () => {
  ctx = await useFreshDb();
  const ownerId = (await upsertUser({ id: "route-owner", name: "Owner", email: null, slackId: null })).id;
  viewerId = (await upsertUser({ id: "route-viewer", name: "Viewer", email: null, slackId: null })).id;

  const viewerServer = (await createServer(viewerId, "route-viewer-server")).id;
  ownedProjectId = (await createProject(viewerId, { ...base, serverId: viewerServer, name: "Mine", port: 3601 })).id;

  const ownerServer = (await createServer(ownerId, "route-owner-server")).id;
  sharedProjectId = (await createProject(ownerId, { ...base, serverId: ownerServer, name: "Theirs", port: 3600 })).id;
  await ctx.db.insert(schema.projectMembers).values({
    projectId: sharedProjectId,
    userId: viewerId,
    role: "viewer",
    createdAt: new Date(),
  });
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("GET /api/projects", () => {
  it("returns owned and shared projects so it agrees with the dashboard and v1", async () => {
    auth.user = viewerId;
    const res = await call();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: { id: string }[] };
    const ids = body.projects.map((p) => p.id);
    expect(ids).toContain(ownedProjectId);
    expect(ids).toContain(sharedProjectId);
  });

  it("keeps projects the user cannot read out of the list", async () => {
    const strangerId = (await upsertUser({ id: "route-stranger", name: "Stranger", email: null, slackId: null })).id;
    const strangerServer = (await createServer(strangerId, "route-stranger-server")).id;
    const strangerProject = (await createProject(strangerId, {
      ...base,
      serverId: strangerServer,
      name: "Secret",
      port: 3602,
    })).id;

    auth.user = viewerId;
    const body = (await (await call()).json()) as { projects: { id: string }[] };
    expect(body.projects.map((p) => p.id)).not.toContain(strangerProject);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { deleteAccount } from "@/server/account";
import { createApiToken, revokeApiToken } from "@/server/api-tokens";
import { upsertUser } from "@/server/auth/session";
import { parseProfile } from "@/server/auth/hackclub";
import { schema } from "@/server/db";
import { createProject, deployBranch, deleteProjectRecords } from "@/server/projects";
import { deleteServer, createServer } from "@/server/servers";
import type { ShellHandle } from "@/server/ssh/shell";
import { TerminalManager } from "@/server/terminal";
import { useFreshDb } from "@/server/test/db";

class FakeShell implements ShellHandle {
  closed = 0;
  write() {}
  resize() {}
  onData() {}
  onClose() {}
  close() {
    this.closed += 1;
  }
}

const MANAGER_KEY = Symbol.for("egg.terminal-manager");

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let manager: TerminalManager;
let shells: FakeShell[];

beforeAll(async () => {
  ctx = await useFreshDb();
});

afterAll(async () => {
  manager?.closeAll();
  delete (globalThis as Record<symbol, unknown>)[MANAGER_KEY];
  await ctx.cleanup();
});

/** The app keeps one terminal manager on globalThis; swap in one whose SSH connection is fake. */
function freshManager() {
  shells = [];
  manager = new TerminalManager({
    connect: async () => {
      const shell = new FakeShell();
      shells.push(shell);
      return { shell, uid: 1000, host: "edge.hackclub.app" };
    },
    audit: async () => {},
  });
  (globalThis as Record<symbol, unknown>)[MANAGER_KEY] = manager;
}

async function userWithProject(hackClubId: string, nest: string, port: number) {
  const user = await upsertUser({ id: hackClubId, name: "Edge User", email: null, slackId: null });
  const server = await createServer(user.id, nest);
  const project = await createProject(user.id, {
    serverId: server.id,
    name: `App ${nest}`,
    repoUrl: `https://github.com/example/${nest}`,
    runtime: "node",
    port,
  });
  return { user, server, project };
}

describe("disconnecting a server", () => {
  it("closes the terminals that are open on it", async () => {
    freshManager();
    const { user, server, project } = await userWithProject("edge-s1", "edge-s1", 3201);
    await manager.open(user.id, project.id, { cols: 80, rows: 24 });
    expect(manager.size).toBe(1);

    await deleteServer(user.id, server.id);

    // The server row and its key are gone, so a root shell that used the key must not stay open.
    expect(manager.size).toBe(0);
    expect(shells[0].closed).toBeGreaterThan(0);
  });

  it("closes the terminals whether or not the projects are deleted", async () => {
    for (const deleteProjects of [false, true]) {
      freshManager();
      const tag = `edge-s2-${deleteProjects}`;
      const { user, server, project } = await userWithProject(tag, tag, deleteProjects ? 3205 : 3204);
      await manager.open(user.id, project.id, { cols: 80, rows: 24 });
      expect(manager.size).toBe(1);

      await deleteServer(user.id, server.id, { deleteProjects });

      expect(manager.size).toBe(0);
      expect(shells[0].closed).toBeGreaterThan(0);
    }
  });
});

describe("deleting a project", () => {
  it("is refused while a deployment of it is still running", async () => {
    const { user, project } = await userWithProject("edge-p1", "edge-p1", 3202);
    const dep = await deployBranch(user.id, project.id);
    await ctx.db.update(schema.deployments).set({ state: "building" }).where(eq(schema.deployments.id, dep.id));

    // Removing the records under a running deploy leaves the worker writing a service and
    // folders to the container for a project that no longer exists.
    await expect(deleteProjectRecords(user.id, project.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("revoking an access token", () => {
  it("closes the terminals that token opened", async () => {
    freshManager();
    const { user, project } = await userWithProject("edge-t1", "edge-t1", 3203);
    const { token } = await createApiToken(user.id, { name: "script", scopes: ["terminal:use"] });
    await manager.open(user.id, project.id, { cols: 80, rows: 24 }, { tokenId: token.id });
    expect(manager.size).toBe(1);

    await revokeApiToken(user.id, token.id);

    expect(manager.size).toBe(0);
  });
});

describe("a token that outlives its owner or fills the allowance", () => {
  it("expired tokens do not count against the 25 active tokens", async () => {
    const user = await upsertUser({ id: "edge-t2", name: "Edge Tokens", email: null, slackId: null });
    const longAgo = new Date(Date.now() - 400 * 86_400_000);
    for (let i = 0; i < 25; i++) {
      await createApiToken(user.id, { name: `old-${i}`, scopes: ["projects:read"], expiresInDays: 7 }, longAgo);
    }
    // All 25 expired a year ago. The error text says "active tokens".
    await expect(createApiToken(user.id, { name: "new", scopes: ["projects:read"] })).resolves.toBeDefined();
  });
});

describe("account deletion confirmation", () => {
  it("can be confirmed by the person whose Hack Club nickname has stray spaces", async () => {
    const profile = parseProfile({ sub: "edge-n1", nickname: "  bob  " });
    const user = await upsertUser({ ...profile, slackId: null });
    // They type their name as they see it.
    await expect(deleteAccount(user.id, user.name, "bob")).resolves.toBeUndefined();
  });
});

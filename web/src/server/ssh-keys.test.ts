import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { open } from "@/server/crypto";
import { resetConfigForTests } from "@/server/config";
import { getDb, schema } from "@/server/db";
import { clearTokenCacheForTests } from "@/server/github/app";
import { createProject, type ProjectRow } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import {
  createPersonalKey,
  createProjectKey,
  listKeysForUser,
  revokeKey,
  rotateProjectKey,
} from "@/server/ssh-keys";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let ownerId: string;
let otherId: string;
let ownerServerId: string;
let githubProject: ProjectRow;
let portSeq = 4100;

type Call = { method: string; url: string; body?: string };

/** Records every GitHub call the service makes and answers from a plan. */
function fakeGithub(plan: (call: Call) => Response | Promise<Response> = () => created(4242)) {
  const calls: Call[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { method: init?.method ?? "GET", url: String(url), body: init?.body as string | undefined };
    calls.push(call);
    return plan(call);
  }) as typeof fetch;
  return { fetcher, calls };
}

const created = (id: number) => Response.json({ id }, { status: 201 });
const deleted = () => new Response(null, { status: 204 });
const failed = (status: number) => new Response("{}", { status });

async function rowOf(id: string) {
  return ctx.db.select().from(schema.sshKeys).where(eq(schema.sshKeys.id, id)).get();
}

/** A GitHub-hosted project of the owner, linked to installation 77 and repo sam/app. */
async function linkedGithubProject(slug: string) {
  return createProject(ownerId, {
    serverId: ownerServerId,
    name: slug,
    slug,
    repoUrl: "https://github.com/sam/app.git",
    repoFullName: "sam/app",
    installationId: 77,
    runtime: "node",
    port: portSeq++,
  });
}

/** The same project, but as if it lived on the owner's own git host. */
async function gitHostProject(slug: string) {
  const project = await linkedGithubProject(slug);
  const db = await getDb();
  await db
    .update(schema.projects)
    .set({ sourceProvider: "gitlab", installationId: null, repoFullName: null })
    .where(eq(schema.projects.id, project.id));
  return { ...project, sourceProvider: "gitlab" as const };
}

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GITHUB_APP_ID = "12345";
  process.env.GITHUB_APP_CLIENT_ID = "Iv1.abc";
  process.env.GITHUB_APP_CLIENT_SECRET = "secret";
  process.env.GITHUB_WEBHOOK_SECRET = "hook-secret";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey
    .export({ type: "pkcs1", format: "pem" })
    .toString()
    .replace(/\n/g, "\\n");
  resetConfigForTests();
  // installationToken() reads the global fetch when no fetcher is given. Only the
  // access-token call is answered here; anything else would reach the network.
  vi.stubGlobal("fetch", (async (url: string | URL | Request) => {
    if (String(url).includes("/access_tokens")) {
      return Response.json({ token: "t", expires_at: new Date(Date.now() + 3_600_000).toISOString() }, { status: 201 });
    }
    throw new Error(`unexpected network call to ${String(url)}`);
  }) as typeof fetch);

  ctx = await useFreshDb();
  const db = await getDb();
  ownerId = (await upsertUser({ id: "k1", name: "Sam", email: null, slackId: null })).id;
  otherId = (await upsertUser({ id: "k2", name: "Kim", email: null, slackId: null })).id;
  ownerServerId = (await createServer(ownerId, "k-one")).id;
  await createServer(otherId, "k-two");
  // Projects may only use an installation their owner has linked.
  await db.insert(schema.githubInstallations).values({
    id: 77,
    userId: ownerId,
    accountLogin: "sam",
    accountType: "User",
    createdAt: new Date(),
  });
  githubProject = await linkedGithubProject("app");
});

afterAll(async () => {
  await ctx.cleanup();
  vi.unstubAllGlobals();
  for (const k of ["GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_WEBHOOK_SECRET", "GITHUB_APP_PRIVATE_KEY"]) {
    delete process.env[k];
  }
  resetConfigForTests();
});

beforeEach(() => {
  clearTokenCacheForTests();
});

describe("personal keys", () => {
  it("seals the private key under the row id and returns it once", async () => {
    const { key, privateKey } = await createPersonalKey(ownerId, { name: "laptop" });
    const row = await rowOf(key.id);
    expect(row).toBeTruthy();
    expect(row!.privateKeyEnc).not.toContain("OPENSSH");
    expect(open(row!.privateKeyEnc, `sshkey:${row!.id}`)).toBe(privateKey);
    expect(privateKey).toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(key).toMatchObject({ kind: "personal", name: "laptop", projectId: null, installed: false, revokedAt: null });
  });

  it("lists the public half, the fingerprint and revocation time, never the private key", async () => {
    const { key, privateKey } = await createPersonalKey(ownerId, { name: "listed" });
    const list = await listKeysForUser(ownerId);
    const found = list.find((k) => k.id === key.id);
    expect(found?.publicKey).toMatch(/^ssh-ed25519 /);
    expect(found?.fingerprint).toMatch(/^SHA256:/);
    expect(JSON.stringify(list)).not.toContain(privateKey);

    await revokeKey(ownerId, key.id);
    const after = (await listKeysForUser(ownerId)).find((k) => k.id === key.id);
    expect(after?.revokedAt).not.toBeNull();
  });

  it("caps active personal keys at 20", async () => {
    const capUser = (await upsertUser({ id: "k-cap", name: "Cap", email: null, slackId: null })).id;
    for (let i = 0; i < 20; i++) await createPersonalKey(capUser, { name: `key ${i}` });
    await expect(createPersonalKey(capUser, { name: "one too many" })).rejects.toMatchObject({ status: 400, code: "limit" });
  });
});

describe("git keys", () => {
  it("gives a git host project a key whose private half is returned once", async () => {
    const project = await gitHostProject("git-one");
    const { key, privateKey } = await createProjectKey(ownerId, project.id, { kind: "git_key", name: "Forge" });
    expect(privateKey).toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(key).toMatchObject({ kind: "git_key", name: "Forge", projectId: project.id, installed: false });
    expect(open((await rowOf(key.id))!.privateKeyEnc, `sshkey:${key.id}`)).toBe(privateKey);
  });

  it("allows only one active git key per project, refusing the second with 409", async () => {
    const project = await gitHostProject("git-two");
    await createProjectKey(ownerId, project.id, { kind: "git_key", name: "first" });
    await expect(createProjectKey(ownerId, project.id, { kind: "git_key", name: "second" })).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    });
  });

  it("refuses a git key for a GitHub project", async () => {
    await expect(createProjectKey(ownerId, githubProject.id, { kind: "git_key" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("refuses a deploy key for a project on another git host", async () => {
    const project = await gitHostProject("git-three");
    await expect(createProjectKey(ownerId, project.id, { kind: "github_deploy" })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("GitHub deploy keys", () => {
  it("needs the repository and installation linked to the project", async () => {
    const project = await gitHostProject("no-repo");
    const db = await getDb();
    await db
      .update(schema.projects)
      .set({ sourceProvider: "github" })
      .where(eq(schema.projects.id, project.id));
    await expect(createProjectKey(ownerId, project.id, { kind: "github_deploy" })).rejects.toMatchObject({
      status: 409,
      code: "repository_required",
    });
  });

  it("installs a read-only key on the repository and stores GitHub's id", async () => {
    const gh = fakeGithub();
    const { key, privateKey } = await createProjectKey(ownerId, githubProject.id, { kind: "github_deploy" }, new Date(), gh.fetcher);

    expect(privateKey).toBeNull();
    expect(key).toMatchObject({ kind: "github_deploy", installed: true, projectId: githubProject.id });
    const row = await rowOf(key.id);
    expect(row!.externalId).toBe("4242");

    expect(gh.calls).toHaveLength(1);
    expect(gh.calls[0]).toMatchObject({ method: "POST", url: "https://api.github.com/repos/sam/app/keys" });
    expect(JSON.parse(gh.calls[0].body!)).toEqual({
      title: "egg app",
      key: row!.publicKey,
      read_only: true,
    });
    // The private half of a deploy key never leaves Egg.
    expect(open(row!.privateKeyEnc, `sshkey:${row!.id}`)).toContain("BEGIN OPENSSH PRIVATE KEY");
  });

  it("maps GitHub refusals onto the matching errors", async () => {
    const project = await linkedGithubProject("refusals");
    await expect(
      createProjectKey(ownerId, project.id, { kind: "github_deploy" }, new Date(), fakeGithub(() => failed(403)).fetcher)
    ).rejects.toMatchObject({ status: 502, code: "upstream" });
    await expect(
      createProjectKey(ownerId, project.id, { kind: "github_deploy" }, new Date(), fakeGithub(() => failed(404)).fetcher)
    ).rejects.toMatchObject({ status: 502, code: "upstream" });
    await expect(
      createProjectKey(ownerId, project.id, { kind: "github_deploy" }, new Date(), fakeGithub(() => failed(500)).fetcher)
    ).rejects.toMatchObject({ status: 502, code: "upstream" });
    await expect(
      createProjectKey(ownerId, project.id, { kind: "github_deploy" }, new Date(), fakeGithub(() => failed(422)).fetcher)
    ).rejects.toMatchObject({ status: 409, code: "conflict" });
    // None of the refused attempts left a row behind.
    const active = (await listKeysForUser(ownerId)).filter((k) => k.projectId === project.id);
    expect(active).toEqual([]);
  });
});

describe("revoking", () => {
  it("removes a deploy key from GitHub before the local row changes", async () => {
    const project = await linkedGithubProject("order");
    const { key } = await createProjectKey(ownerId, project.id, { kind: "github_deploy" }, new Date(), fakeGithub().fetcher);

    let revokedAtDuringDelete: unknown = "not called";
    const gh = fakeGithub(async (call) => {
      if (call.method === "DELETE") revokedAtDuringDelete = (await rowOf(key.id))!.revokedAt;
      return deleted();
    });
    await revokeKey(ownerId, key.id, new Date(), gh.fetcher);

    expect(gh.calls).toEqual([expect.objectContaining({ method: "DELETE", url: "https://api.github.com/repos/sam/app/keys/4242" })]);
    expect(revokedAtDuringDelete).toBeNull();
    const row = await rowOf(key.id);
    expect(row!.revokedAt).not.toBeNull();
    expect(open(row!.privateKeyEnc, `sshkey:${key.id}`)).toBe("removed");
    expect(row!.externalId).toBeNull();
  });

  it("keeps the key active when GitHub cannot remove it", async () => {
    const project = await linkedGithubProject("stuck");
    const { key } = await createProjectKey(ownerId, project.id, { kind: "github_deploy" }, new Date(), fakeGithub().fetcher);

    const gh = fakeGithub(() => failed(500));
    await expect(revokeKey(ownerId, key.id, new Date(), gh.fetcher)).rejects.toMatchObject({ status: 502, code: "upstream" });
    const row = await rowOf(key.id);
    expect(row!.revokedAt).toBeNull();
    expect(row!.externalId).toBe("4242");
    expect(open(row!.privateKeyEnc, `sshkey:${key.id}`)).not.toBe("removed");
  });

  it("refuses a second revoke and a stranger's key with 404", async () => {
    const { key } = await createPersonalKey(ownerId, { name: "once" });
    await revokeKey(ownerId, key.id);
    await expect(revokeKey(ownerId, key.id)).rejects.toMatchObject({ status: 404 });

    const { key: mine } = await createPersonalKey(ownerId, { name: "mine" });
    await expect(revokeKey(otherId, mine.id)).rejects.toMatchObject({ status: 404 });
    expect((await rowOf(mine.id))!.revokedAt).toBeNull();
  });
});

describe("rotating a project key", () => {
  it("installs a new deploy key, revokes the old one and removes it from GitHub", async () => {
    const project = await linkedGithubProject("rotate-me");
    const first = await createProjectKey(ownerId, project.id, { kind: "github_deploy" }, new Date(), fakeGithub(() => created(111)).fetcher);

    const gh = fakeGithub((call) => (call.method === "POST" ? created(222) : deleted()));
    const result = await rotateProjectKey(ownerId, project.id, { kind: "github_deploy" }, new Date(), gh.fetcher);

    expect(result).toMatchObject({ privateKey: null, removedFromGithub: true });
    expect(result.key).toMatchObject({ kind: "github_deploy", installed: true });
    expect((await rowOf(result.key.id))!.externalId).toBe("222");
    expect(gh.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://api.github.com/repos/sam/app/keys",
      "DELETE https://api.github.com/repos/sam/app/keys/111",
    ]);

    const old = await rowOf(first.key.id);
    expect(old!.revokedAt).not.toBeNull();
    expect(open(old!.privateKeyEnc, `sshkey:${old!.id}`)).toBe("removed");
    expect(old!.externalId).toBeNull();
  });

  it("works when the project had no key yet", async () => {
    const project = await linkedGithubProject("rotate-fresh");
    const gh = fakeGithub(() => created(333));
    const result = await rotateProjectKey(ownerId, project.id, { kind: "github_deploy" }, new Date(), gh.fetcher);
    expect(result.removedFromGithub).toBe(true);
    expect(gh.calls).toHaveLength(1);
    expect((await rowOf(result.key.id))!.externalId).toBe("333");
  });

  it("leaves the old key untouched when GitHub already knows the new public key", async () => {
    const project = await linkedGithubProject("rotate-dup");
    const first = await createProjectKey(ownerId, project.id, { kind: "github_deploy" }, new Date(), fakeGithub(() => created(555)).fetcher);

    const gh = fakeGithub(() => failed(422));
    await expect(
      rotateProjectKey(ownerId, project.id, { kind: "github_deploy" }, new Date(), gh.fetcher)
    ).rejects.toMatchObject({ status: 409, code: "conflict" });

    const old = await rowOf(first.key.id);
    expect(old!.revokedAt).toBeNull();
    expect(old!.externalId).toBe("555");
    expect(gh.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("returns a fresh git key once and revokes the old one", async () => {
    const project = await gitHostProject("rotate-git");
    const first = await createProjectKey(ownerId, project.id, { kind: "git_key", name: "Forge" });
    const result = await rotateProjectKey(ownerId, project.id, { kind: "git_key" });

    expect(result.privateKey).toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(result.removedFromGithub).toBe(true);
    expect(result.key).toMatchObject({ kind: "git_key", name: "Forge" });
    expect((await rowOf(first.key.id))!.revokedAt).not.toBeNull();
  });
});

describe("ownership between users", () => {
  it("keeps one user's project keys away from another", async () => {
    const project = await gitHostProject("owned");
    const { key } = await createProjectKey(ownerId, project.id, { kind: "git_key", name: "mine" });

    await expect(createProjectKey(otherId, project.id, { kind: "git_key" })).rejects.toMatchObject({ status: 404 });
    await expect(rotateProjectKey(otherId, project.id, { kind: "git_key" })).rejects.toMatchObject({ status: 404 });
    await expect(revokeKey(otherId, key.id)).rejects.toMatchObject({ status: 404 });

    expect((await listKeysForUser(otherId)).map((k) => k.id)).not.toContain(key.id);
    expect((await rowOf(key.id))!.revokedAt).toBeNull();
  });
});

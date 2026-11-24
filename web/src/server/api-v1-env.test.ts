import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Principal, Scope } from "@/server/api-tokens";
import { callEndpoint } from "@/server/api-v1";
import {
  apiEnvAdd,
  apiEnvDelete,
  apiEnvList,
  apiEnvSet,
  ENV_ENDPOINTS,
} from "@/server/api-v1-env";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject, listEnvVars, revealEnvVar, setEnvVar } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

/** Values planted in the database that must never appear in a response or error. */
const SECRET_ALPHA = "alpha-secret-value-a9f3";
const SECRET_ZED = "zed-secret-value-b7c1";
const SECRET_NEW = "new-secret-value-d2e4";
const SECRET_LEAKY = "leaky-value-should-not-appear-6c8f";

const PROJECT_NAME = "Env App";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let owner: { id: string };
let outsider: { id: string };
let projectId: string;
let projectName: string;
let theirProjectId: string;

const endpoint = (id: string) => {
  const found = ENV_ENDPOINTS.find((e) => e.id === id);
  expect(found, `endpoint ${id} exists`).toBeDefined();
  if (!found) throw new Error(`Missing endpoint ${id}`);
  return found;
};
const principal = (userId: string, scopes: Scope[]): Principal => ({ userId, tokenId: "env-token", scopes });
const call = (
  userId: string,
  scopes: Scope[],
  id: string,
  input: Record<string, unknown> = {},
  idValue = projectId
) => callEndpoint(principal(userId, scopes), endpoint(id), { ...input, projectId: idValue });

const names = async (userId = owner.id, id = projectId) =>
  (await listEnvVars(userId, id)).map(({ key, target }) => ({ key, target }));

beforeAll(async () => {
  ctx = await useFreshDb();
  owner = await upsertUser({ id: "env-owner", name: "Sam", email: null, slackId: null });
  outsider = await upsertUser({ id: "env-outsider", name: "Kim", email: null, slackId: null });
  const server = (await createServer(owner.id, "env-sam")).id;
  const theirServer = (await createServer(outsider.id, "env-kim")).id;
  const base = { repoUrl: "https://github.com/sam/env.git", runtime: "node" as const };
  const created = await createProject(owner.id, {
    ...base,
    serverId: server,
    name: PROJECT_NAME,
    slug: "env-app",
    port: 3960,
  });
  projectId = created.id;
  projectName = created.name;
  theirProjectId = (await createProject(outsider.id, {
    ...base,
    repoUrl: "https://github.com/kim/env.git",
    serverId: theirServer,
    name: "Theirs",
    slug: "theirs-env",
    port: 3961,
  })).id;
});

afterAll(async () => ctx.cleanup());

beforeEach(async () => {
  await ctx.db.delete(schema.envVars);
  await setEnvVar(owner.id, projectId, { key: "ALPHA", value: SECRET_ALPHA, target: "all" });
  await setEnvVar(owner.id, projectId, { key: "ZED", value: SECRET_ZED, target: "production" });
  await setEnvVar(outsider.id, theirProjectId, { key: "OTHER", value: SECRET_NEW, target: "all" });
});

describe("the environment endpoint descriptions", () => {
  it("offers the four batch tool names, one read and three writes", () => {
    expect(ENV_ENDPOINTS.map((e) => e.id)).toEqual([
      "list_env_vars",
      "add_env_vars",
      "set_env_vars",
      "delete_env_vars",
    ]);
    expect(endpoint("list_env_vars")).toMatchObject({
      method: "GET",
      path: "/projects/{projectId}/env",
      scope: "env:read",
      bucket: "read",
      tag: "Environment",
      readOnly: true,
      destructive: false,
      untrusted: false,
    });
    for (const [id, method, sensitive, destructive] of [
      ["add_env_vars", "POST", true, false],
      ["set_env_vars", "PUT", true, true],
      ["delete_env_vars", "DELETE", true, true],
    ] as const) {
      expect(endpoint(id)).toMatchObject({
        method,
        path: "/projects/{projectId}/env",
        scope: "env:write",
        bucket: "write",
        tag: "Environment",
        readOnly: false,
        sensitive,
        destructive,
      });
    }
  });

  it("takes only the declared fields", () => {
    expect(endpoint("list_env_vars").input.safeParse({ projectId: "P" }).success).toBe(true);
    expect(endpoint("add_env_vars").input.safeParse({ projectId: "P", envVars: [{ key: "A", value: "v" }] }).success).toBe(true);
    expect(endpoint("set_env_vars").input.safeParse({ projectId: "P", envVars: [], confirmName: PROJECT_NAME }).success).toBe(true);
    expect(endpoint("delete_env_vars").input.safeParse({ projectId: "P", keys: ["A"], confirmName: PROJECT_NAME }).success).toBe(true);
    for (const ep of ENV_ENDPOINTS) {
      expect(ep.input.safeParse({ projectId: "P", surprise: 1 }).success).toBe(false);
    }
    expect(endpoint("add_env_vars").input.safeParse({ projectId: "P" }).success).toBe(false);
    expect(endpoint("set_env_vars").input.safeParse({ projectId: "P", envVars: [] }).success).toBe(false);
    expect(endpoint("delete_env_vars").input.safeParse({ projectId: "P", keys: [], confirmName: PROJECT_NAME }).success).toBe(false);
  });

  it("declares responses that can never carry a value", () => {
    const sample = {
      env: [{ key: "A", target: "all", value: SECRET_LEAKY }],
      items: [{ key: "A", target: "all", value: SECRET_LEAKY }],
      deleted: [{ key: "A", target: "all", value: SECRET_LEAKY }],
      total: 1,
      nextCursor: null,
    };
    for (const ep of ENV_ENDPOINTS) {
      const parsed = ep.response.parse(sample) as Record<string, unknown>;
      expect(JSON.stringify(parsed)).not.toContain(SECRET_LEAKY);
      for (const field of ["env", "items", "deleted"]) {
        if (Array.isArray(parsed[field])) {
          expect(parsed[field]).toEqual([{ key: "A", target: "all" }]);
        }
      }
    }
  });
});

describe("list_env_vars", () => {
  it("lists only names and targets, in a stable order", async () => {
    const result = await call(owner.id, ["env:read"], "list_env_vars");
    expect(result).toEqual({
      env: [
        { key: "ALPHA", target: "all" },
        { key: "ZED", target: "production" },
      ],
      items: [
        { key: "ALPHA", target: "all" },
        { key: "ZED", target: "production" },
      ],
      total: 2,
      nextCursor: null,
    });
    expect(JSON.stringify(result)).not.toContain(SECRET_ALPHA);
    expect(JSON.stringify(result)).not.toContain(SECRET_ZED);
  });

  it("pages with limit and cursor while env stays complete", async () => {
    type Page = { env: unknown[]; items: unknown[]; total: number; nextCursor: string | null };
    const first = (await call(owner.id, ["env:read"], "list_env_vars", { limit: 1 })) as Page;
    expect(first).toMatchObject({ env: expect.any(Array), items: [{ key: "ALPHA" }], total: 2 });
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await call(owner.id, ["env:read"], "list_env_vars", { limit: 1, cursor: first.nextCursor })) as Page;
    expect(second).toMatchObject({ items: [{ key: "ZED", target: "production" }], total: 2, nextCursor: null });
    expect(second.env).toHaveLength(2);
  });

  it("needs env:read and hides another owner's project", async () => {
    await expect(call(owner.id, ["projects:read"], "list_env_vars")).rejects.toMatchObject({ status: 403 });
    await expect(call(owner.id, ["env:read"], "list_env_vars", {}, theirProjectId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("add_env_vars", () => {
  it("merges new entries, keeps the others and never returns the value", async () => {
    const result = await call(owner.id, ["env:write"], "add_env_vars", {
      envVars: [{ key: "NEW_ONE", value: SECRET_NEW, target: "preview" }],
    });
    expect(result).toEqual({ env: [{ key: "NEW_ONE", target: "preview" }] });
    expect(JSON.stringify(result)).not.toContain(SECRET_NEW);
    expect(await revealEnvVar(projectId, "NEW_ONE", "preview")).toBe(SECRET_NEW);
    expect(await names()).toEqual([
      { key: "ALPHA", target: "all" },
      { key: "NEW_ONE", target: "preview" },
      { key: "ZED", target: "production" },
    ]);
  });

  it("replaces one existing name and target without adding a second row", async () => {
    const result = await call(owner.id, ["env:write"], "add_env_vars", {
      envVars: [{ key: "ALPHA", value: SECRET_NEW, target: "all" }],
    });
    expect(result).toEqual({ env: [{ key: "ALPHA", target: "all" }] });
    expect(await revealEnvVar(projectId, "ALPHA", "all")).toBe(SECRET_NEW);
    expect((await listEnvVars(owner.id, projectId)).filter((row) => row.key === "ALPHA")).toHaveLength(1);
  });

  it("tags the service's audit entry with the token and never writes the value there", async () => {
    await call(owner.id, ["env:write"], "add_env_vars", {
      envVars: [{ key: "AUDITED", value: SECRET_NEW, target: "all" }],
    });
    const rows = await ctx.db.select().from(schema.auditLog).where(and(
      eq(schema.auditLog.userId, owner.id),
      eq(schema.auditLog.action, "env.set")
    ));
    const last = rows.at(-1);
    expect(last?.meta).toContain('"via":"api"');
    expect(last?.meta).toContain('"token":"env-token"');
    expect(last?.meta).not.toContain(SECRET_NEW);
  });

  it("refuses bad batches and does not echo the value in the error", async () => {
    const bad = [
      { envVars: [{ key: "1BAD", value: SECRET_LEAKY }] },
      { envVars: [{ key: "PORT", value: SECRET_LEAKY }] },
      { envVars: [{ key: "OK_KEY", value: SECRET_LEAKY, target: "staging" }] },
      { envVars: [{ key: "OK_KEY", value: SECRET_LEAKY }, { key: "OK_KEY", value: "x", target: "all" }] },
      { envVars: [{ key: "OK_KEY", value: SECRET_LEAKY }], surprise: 1 },
    ];
    for (const input of bad) {
      const error = await call(owner.id, ["env:write"], "add_env_vars", input).then(
        () => null,
        (err: Error) => err
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as { status?: number })?.status).toBe(400);
      expect((error as Error).message).not.toContain(SECRET_LEAKY);
    }
    expect(await names()).toHaveLength(2);
  });

  it("needs env:write and hides another owner's project", async () => {
    const input = { envVars: [{ key: "NEW_ONE", value: SECRET_NEW }] };
    await expect(call(owner.id, ["env:read"], "add_env_vars", input)).rejects.toMatchObject({ status: 403 });
    await expect(call(owner.id, ["env:write"], "add_env_vars", input, theirProjectId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("set_env_vars", () => {
  it("replaces the whole environment and reports what went, without values", async () => {
    const result = await call(owner.id, ["env:write"], "set_env_vars", {
      envVars: [{ key: "BRAND_NEW", value: SECRET_NEW, target: "production" }],
      confirmName: projectName,
    });
    expect(result).toEqual({
      env: [{ key: "BRAND_NEW", target: "production" }],
      deleted: [
        { key: "ALPHA", target: "all" },
        { key: "ZED", target: "production" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(SECRET_ALPHA);
    expect(JSON.stringify(result)).not.toContain(SECRET_ZED);
    expect(JSON.stringify(result)).not.toContain(SECRET_NEW);
    expect(await names()).toEqual([{ key: "BRAND_NEW", target: "production" }]);
    expect(await revealEnvVar(projectId, "BRAND_NEW", "production")).toBe(SECRET_NEW);
    expect(await revealEnvVar(projectId, "ALPHA", "all")).toBeNull();
  });

  it("requires the exact project name and the write scope", async () => {
    const input = { envVars: [{ key: "BRAND_NEW", value: SECRET_NEW }], confirmName: "wrong" };
    await expect(call(owner.id, ["env:write"], "set_env_vars", input)).rejects.toMatchObject({ status: 400 });
    await expect(call(owner.id, ["env:read"], "set_env_vars", { ...input, confirmName: projectName })).rejects.toMatchObject({ status: 403 });
    await expect(call(owner.id, ["env:write"], "set_env_vars", { ...input, confirmName: projectName }, theirProjectId)).rejects.toMatchObject({ status: 404 });
    expect(await names()).toHaveLength(2);
  });
});

describe("delete_env_vars", () => {
  it("deletes one target and then every target of a name, reporting names only", async () => {
    const one = await call(owner.id, ["env:write"], "delete_env_vars", {
      keys: ["ZED"],
      confirmName: projectName,
      target: "production",
    });
    expect(one).toEqual({ deleted: [{ key: "ZED", target: "production" }] });
    expect(await names()).toEqual([{ key: "ALPHA", target: "all" }]);
    const all = await call(owner.id, ["env:write"], "delete_env_vars", {
      keys: ["ALPHA"],
      confirmName: projectName,
    });
    expect(all).toEqual({ deleted: [{ key: "ALPHA", target: "all" }] });
    expect(JSON.stringify(all)).not.toContain(SECRET_ALPHA);
    expect(await names()).toEqual([]);
  });

  it("needs the exact project name, a known key, the write scope, and the right owner", async () => {
    await expect(call(owner.id, ["env:write"], "delete_env_vars", {
      keys: ["ZED"], confirmName: "wrong",
    })).rejects.toMatchObject({ status: 400 });
    await expect(call(owner.id, ["env:write"], "delete_env_vars", {
      keys: ["MISSING"], confirmName: projectName,
    })).rejects.toMatchObject({ status: 404 });
    await expect(call(owner.id, ["env:read"], "delete_env_vars", {
      keys: ["ZED"], confirmName: projectName,
    })).rejects.toMatchObject({ status: 403 });
    await expect(call(owner.id, ["env:write"], "delete_env_vars", {
      keys: ["OTHER"], confirmName: projectName,
    }, theirProjectId)).rejects.toMatchObject({ status: 404 });
    expect(await names()).toHaveLength(2);
    expect(await names(outsider.id, theirProjectId)).toEqual([{ key: "OTHER", target: "all" }]);
  });
});

describe("the service functions", () => {
  it("check the scope themselves, not just in the transport", async () => {
    await expect(apiEnvList(principal(owner.id, []), projectId)).rejects.toMatchObject({ status: 403 });
    await expect(apiEnvAdd(principal(owner.id, []), projectId, [{ key: "A", value: "v", target: "all" }])).rejects.toMatchObject({ status: 403 });
    await expect(apiEnvSet(principal(owner.id, []), projectId, projectName, [
      { key: "A", value: "v", target: "all" as const },
    ])).rejects.toMatchObject({ status: 403 });
    await expect(apiEnvDelete(principal(owner.id, []), projectId, projectName, ["ALPHA"], undefined)).rejects.toMatchObject({ status: 403 });
  });
});

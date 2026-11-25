import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal, Scope } from "@/server/api-tokens";
import { callEndpoint, ENDPOINTS } from "@/server/api-v1";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject, setEnvVar } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

const SECRET_ALPHA = "plain-values-secret-alpha-946a";
const SECRET_ZED = "plain-values-secret-zed-2c18";
const VALUE_NEW = "plain-values-new-0d33";
const PROJECT_NAME = "Plain Values App";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let owner: { id: string };
let outsider: { id: string };
let projectId: string;
let projectName: string;
let theirProjectId: string;

const principal = (userId: string, scopes: Scope[]): Principal => ({ userId, tokenId: "plain-values-token", scopes });
const call = (
  userId: string,
  scopes: Scope[],
  id: string,
  input: Record<string, unknown> = {},
  idValue = projectId,
) => {
  const ep = ENDPOINTS.find((entry) => entry.id === id);
  if (!ep) throw new Error(`Missing endpoint ${id}`);
  return callEndpoint(principal(userId, scopes), ep, { ...input, projectId: idValue });
};

beforeAll(async () => {
  ctx = await useFreshDb();
  owner = await upsertUser({ id: "env-plain-owner", name: "Sam", email: null, slackId: null });
  outsider = await upsertUser({ id: "env-plain-outsider", name: "Kim", email: null, slackId: null });
  const server = (await createServer(owner.id, "env-plain-sam")).id;
  const theirServer = (await createServer(outsider.id, "env-plain-kim")).id;
  const base = { repoUrl: "https://github.com/sam/plain-values.git", runtime: "node" as const };
  const created = await createProject(owner.id, {
    ...base,
    serverId: server,
    name: PROJECT_NAME,
    slug: "plain-values-app",
    port: 3962,
  });
  projectId = created.id;
  projectName = created.name;
  theirProjectId = (await createProject(outsider.id, {
    ...base,
    repoUrl: "https://github.com/kim/plain-values.git",
    serverId: theirServer,
    name: "Theirs",
    slug: "plain-values-theirs",
    port: 3963,
  })).id;
});

afterAll(async () => ctx.cleanup());

beforeEach(async () => {
  await ctx.db.delete(schema.envVars);
  await setEnvVar(owner.id, projectId, { key: "ALPHA", value: SECRET_ALPHA, target: "all" });
  await setEnvVar(owner.id, projectId, { key: "ZED", value: SECRET_ZED, target: "production" });
  await setEnvVar(outsider.id, theirProjectId, { key: "OTHER", value: SECRET_ZED, target: "all" });
});

describe("get_env_vars", () => {
  it("returns names, targets and secret flags without returning secret values", async () => {
    const result = await call(owner.id, ["env:read"], "get_env_vars");
    expect(result).toEqual({
      env: [
        { key: "ALPHA", target: "all", secret: true },
        { key: "ZED", target: "production", secret: true },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(SECRET_ALPHA);
    expect(JSON.stringify(result)).not.toContain(SECRET_ZED);
  });

  it("returns a value only after that key and target is explicitly marked non-secret", async () => {
    await call(owner.id, ["env:write"], "set_env_var_secret", { key: "ALPHA", target: "all", secret: false });
    const result = await call(owner.id, ["env:read"], "get_env_vars");
    expect(result).toEqual({
      env: [
        { key: "ALPHA", target: "all", secret: false, value: SECRET_ALPHA },
        { key: "ZED", target: "production", secret: true },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(SECRET_ZED);
  });

  it("defaults new variables to secret and value writes leave the flag unchanged", async () => {
    await call(owner.id, ["env:write"], "add_env_vars", {
      envVars: [{ key: "NEW_KEY", value: VALUE_NEW, target: "preview" }],
    });
    let result = await call(owner.id, ["env:read"], "get_env_vars") as { env: { key: string; secret: boolean; value?: string }[] };
    expect(result.env.find((entry) => entry.key === "NEW_KEY")).toEqual({ key: "NEW_KEY", secret: true, target: "preview" });

    await call(owner.id, ["env:write"], "set_env_var_secret", { key: "ALPHA", target: "all", secret: false });
    await call(owner.id, ["env:write"], "add_env_vars", {
      envVars: [{ key: "ALPHA", value: VALUE_NEW, target: "all" }],
    });
    result = await call(owner.id, ["env:read"], "get_env_vars") as { env: { key: string; secret: boolean; value?: string }[] };
    expect(result.env.find((entry) => entry.key === "ALPHA")).toEqual({ key: "ALPHA", secret: false, target: "all", value: VALUE_NEW });
  });

  it("keeps the flag when replacing the whole set and defaults newly added rows to secret", async () => {
    await call(owner.id, ["env:write"], "set_env_var_secret", { key: "ALPHA", target: "all", secret: false });
    await call(owner.id, ["env:write"], "set_env_vars", {
      confirmName: projectName,
      envVars: [
        { key: "ALPHA", value: VALUE_NEW, target: "all" },
        { key: "NEW_KEY", value: SECRET_ZED, target: "preview" },
      ],
    });
    const result = await call(owner.id, ["env:read"], "get_env_vars");
    expect(result).toEqual({
      env: [
        { key: "ALPHA", target: "all", secret: false, value: VALUE_NEW },
        { key: "NEW_KEY", target: "preview", secret: true },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(SECRET_ZED);
  });

  it("requires env:read, and the flag PATCH requires env:write and project ownership", async () => {
    await expect(call(owner.id, ["projects:read"], "get_env_vars")).rejects.toMatchObject({ status: 403 });
    await expect(call(owner.id, ["env:read"], "set_env_var_secret", {
      key: "ALPHA", target: "all", secret: false,
    })).rejects.toMatchObject({ status: 403 });
    await expect(call(owner.id, ["env:write"], "set_env_var_secret", {
      key: "OTHER", target: "all", secret: false,
    }, theirProjectId)).rejects.toMatchObject({ status: 404 });
  });
});

import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { tagAudit } from "@/server/api-v1-audit";
import { endpoint, NOT_FOUND_NOTE, type Endpoint } from "@/server/api-v1-kit";
import { envInput } from "@/server/projects";
import {
  createEnvironmentSet,
  deleteEnvironmentSet,
  deleteSharedEnvironmentVariables,
  environmentSetIdInput,
  environmentSetInput,
  listEnvironmentSets,
  listSharedEnvironmentVariables,
  mergeSharedEnvironmentVariables,
  renameEnvironmentSet,
  replaceSharedEnvironmentVariables,
  setDefaultEnvironmentSet,
} from "@/server/shared-environments";

const environmentId = environmentSetIdInput.describe("The environment id, from list_environments.");
const environmentName = environmentSetInput.shape.name;
const confirmName = z.string().min(1).max(100).describe("The exact environment name to confirm this action.");
const envTarget = envInput.shape.target.removeDefault();
const envEntrySchema = z.object({
  key: envInput.shape.key,
  target: z.enum(["all", "production", "preview"]),
});
const envValueSchema = z.object({
  key: envInput.shape.key,
  value: envInput.shape.value.describe("The value, up to 10000 characters. Encrypted at rest and never returned."),
  target: envTarget,
});
const envValues = z.array(envValueSchema).max(100).superRefine((entries, ctx) => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const key = entry.key + "\u0000" + entry.target;
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: [index, "key"], message: "Each key and target may appear once." });
    seen.add(key);
  });
});
const envKeys = z.array(envInput.shape.key).min(1).max(100).superRefine((keys, ctx) => {
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Each key may appear once." });
});

const environmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
});

export async function apiListEnvironments(p: Principal) {
  requireScope(p, "env:read");
  return { environments: await listEnvironmentSets(p.userId) };
}

export async function apiCreateEnvironment(p: Principal, input: { name: string }) {
  requireScope(p, "env:write");
  const environment = await tagAudit(p, "env.sets.create", () => createEnvironmentSet(p.userId, input), { name: input.name });
  return { environment };
}

export async function apiRenameEnvironment(p: Principal, id: string, input: { name: string }) {
  requireScope(p, "env:write");
  const environment = await tagAudit(p, "env.sets.rename", () => renameEnvironmentSet(p.userId, id, input), { name: input.name });
  return { environment };
}

export async function apiDeleteEnvironment(p: Principal, id: string, confirmation: string) {
  requireScope(p, "env:write");
  const deleted = await tagAudit(p, "env.sets.delete", () => deleteEnvironmentSet(p.userId, id, confirmation));
  return { deleted };
}

export async function apiSetDefaultEnvironment(p: Principal, id: string) {
  requireScope(p, "env:write");
  const environment = await tagAudit(p, "env.sets.default", () => setDefaultEnvironmentSet(p.userId, id));
  return { environment };
}

export async function apiGetSharedEnvVars(p: Principal, id: string) {
  requireScope(p, "env:read");
  const env = (await listSharedEnvironmentVariables(p.userId, id)).map(({ key, target }) => ({ key, target }));
  return { env };
}

export async function apiAddSharedEnvVars(p: Principal, id: string, entries: z.output<typeof envValues>) {
  requireScope(p, "env:write");
  const env = await tagAudit(
    p,
    "env.sets.variables.set",
    () => mergeSharedEnvironmentVariables(p.userId, id, entries),
    { count: entries.length },
  );
  return { env };
}

export async function apiReplaceSharedEnvVars(
  p: Principal,
  id: string,
  confirmation: string,
  entries: z.output<typeof envValues>,
) {
  requireScope(p, "env:write");
  const result = await tagAudit(
    p,
    "env.sets.variables.replace",
    () => replaceSharedEnvironmentVariables(p.userId, id, confirmation, entries),
    { count: entries.length },
  );
  return result;
}

export async function apiDeleteSharedEnvVars(
  p: Principal,
  id: string,
  confirmation: string,
  keys: string[],
  target?: "all" | "production" | "preview",
) {
  requireScope(p, "env:write");
  const deleted = await tagAudit(
    p,
    "env.sets.variables.delete",
    () => deleteSharedEnvironmentVariables(p.userId, id, confirmation, { keys, target }),
    { names: keys.join(", "), target: target ?? "all" },
  );
  return { deleted };
}

export const ENVIRONMENT_SET_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "list_environments",
    method: "GET",
    path: "/environments",
    scope: "env:read",
    bucket: "read",
    tag: "Environment",
    summary: "List shared environments",
    description: `List your account-wide environment sets. A set marked isDefault is applied to all your projects on their next deployment; project variables take precedence. Variable names and targets are listed separately, but values are never returned.`,
    response: z.object({ environments: z.array(environmentSchema) }),
    run: (p) => apiListEnvironments(p),
  }),
  endpoint({
    id: "create_environment",
    method: "POST",
    path: "/environments",
    scope: "env:write",
    bucket: "write",
    status: 201,
    tag: "Environment",
    summary: "Create a shared environment",
    description: "Create an account-wide environment set. The first set becomes the default; later sets do not change the current default. Names are unique per account.",
    body: { name: environmentName },
    response: z.object({ environment: environmentSchema }),
    errors: [400, 409],
    run: (p, i) => apiCreateEnvironment(p, i),
  }),
  endpoint({
    id: "rename_environment",
    method: "PATCH",
    path: "/environments/{environmentId}",
    scope: "env:write",
    bucket: "write",
    tag: "Environment",
    summary: "Rename a shared environment",
    description: `Rename one of your environment sets. Names are unique per account. ${NOT_FOUND_NOTE}`,
    pathParams: { environmentId },
    body: { name: environmentName },
    response: z.object({ environment: environmentSchema }),
    errors: [400, 404, 409],
    run: (p, i) => apiRenameEnvironment(p, i.environmentId, i),
  }),
  endpoint({
    id: "delete_environment",
    method: "DELETE",
    path: "/environments/{environmentId}",
    scope: "env:write",
    bucket: "write",
    tag: "Environment",
    summary: "Delete a shared environment",
    description: `Delete an environment and its variables. The selected default becomes unset; projects then deploy without shared variables until another set is chosen. Requires confirmName to match the environment name. ${NOT_FOUND_NOTE}`,
    pathParams: { environmentId },
    body: { confirmName },
    response: z.object({ deleted: z.object({ id: z.string(), name: z.string() }) }),
    errors: [400, 404],
    destructive: true,
    run: (p, i) => apiDeleteEnvironment(p, i.environmentId, i.confirmName),
  }),
  endpoint({
    id: "set_default_environment",
    method: "PUT",
    path: "/environments/{environmentId}/default",
    scope: "env:write",
    bucket: "write",
    tag: "Environment",
    summary: "Choose the default shared environment",
    description: `Make this environment the one applied to all your projects. Only one set can be the default per account. ${NOT_FOUND_NOTE}`,
    pathParams: { environmentId },
    response: z.object({ environment: environmentSchema }),
    errors: [404],
    run: (p, i) => apiSetDefaultEnvironment(p, i.environmentId),
  }),
  endpoint({
    id: "get_shared_env_vars",
    method: "GET",
    path: "/environments/{environmentId}/variables",
    scope: "env:read",
    bucket: "read",
    tag: "Environment",
    summary: "List shared variable names",
    description: `List the keys and targets in a shared environment. Values are write-only and never returned. ${NOT_FOUND_NOTE}`,
    pathParams: { environmentId },
    response: z.object({ env: z.array(envEntrySchema) }),
    errors: [404],
    run: (p, i) => apiGetSharedEnvVars(p, i.environmentId),
  }),
  endpoint({
    id: "add_shared_env_vars",
    method: "POST",
    path: "/environments/{environmentId}/variables",
    scope: "env:write",
    bucket: "write",
    sensitive: true,
    tag: "Environment",
    summary: "Add or update shared variables",
    description: `Add or replace the supplied shared variables and leave other keys and targets unchanged. Values are encrypted at rest, write-only and never returned. Changes take effect on the next deployment. Project variables override shared values. ${NOT_FOUND_NOTE}`,
    pathParams: { environmentId },
    body: { envVars: envValues },
    response: z.object({ env: z.array(envEntrySchema) }),
    errors: [400, 404],
    maxBodyBytes: 1_048_576,
    run: (p, i) => apiAddSharedEnvVars(p, i.environmentId, i.envVars),
  }),
  endpoint({
    id: "set_shared_env_vars",
    method: "PUT",
    path: "/environments/{environmentId}/variables",
    scope: "env:write",
    bucket: "write",
    sensitive: true,
    tag: "Environment",
    summary: "Replace shared variables",
    description: `Replace all variables and targets in a shared environment. Omitted entries are deleted. Changes take effect on the next deployment. Existing values are write-only and cannot be read back. Requires confirmName to match the environment name. ${NOT_FOUND_NOTE}`,
    pathParams: { environmentId },
    body: { envVars: envValues, confirmName },
    response: z.object({ env: z.array(envEntrySchema), deleted: z.array(envEntrySchema) }),
    errors: [400, 404],
    destructive: true,
    maxBodyBytes: 1_048_576,
    run: (p, i) => apiReplaceSharedEnvVars(p, i.environmentId, i.confirmName, i.envVars),
  }),
  endpoint({
    id: "delete_shared_env_vars",
    method: "DELETE",
    path: "/environments/{environmentId}/variables",
    scope: "env:write",
    bucket: "write",
    tag: "Environment",
    summary: "Delete shared variables",
    description: `Remove every target for the named keys, or only the selected target. Requires confirmName to match the environment name. Values are never returned. ${NOT_FOUND_NOTE}`,
    pathParams: { environmentId },
    body: {
      keys: envKeys,
      confirmName,
      target: envTarget.optional(),
    },
    response: z.object({ deleted: z.array(envEntrySchema) }),
    errors: [400, 404],
    destructive: true,
    run: (p, i) => apiDeleteSharedEnvVars(p, i.environmentId, i.confirmName, i.keys, i.target),
  }),
];

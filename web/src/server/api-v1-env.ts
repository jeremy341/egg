import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { tagAudit } from "@/server/api-v1-audit";
import { endpoint, NOT_FOUND_NOTE, projectIdInput, type Endpoint } from "@/server/api-v1-kit";
import { paginateList } from "@/server/api-v1-models";
import { HttpError, notFound } from "@/server/http";
import {
  deleteEnvVar,
  envInput,
  getProjectForUser,
  listEnvVars,
  mergeEnvVars,
  replaceEnvVars,
} from "@/server/projects";

/**
 * Environment variables for agents. The four endpoints below cover the batch
 * tool names from Orchard: list names, merge a few, replace the whole set and
 * delete by name. All of them go through the same services the dashboard uses,
 * so the storage, limits and audit entries stay identical.
 *
 * The batch operations keep supplied values out of their successful responses
 * and errors. `get_env_vars` is the explicit read path and returns a value only
 * for a variable that was separately marked non-secret.
 */

const projectId = projectIdInput;
const confirmName = z.string().min(1).max(100).describe("The exact project name to confirm this action.");
const envTarget = envInput.shape.target;
const envEntrySchema = z.object({
  key: envInput.shape.key,
  target: z.enum(["all", "production", "preview"]).describe("Which deployments get it."),
});
const envValueSchema = z.object({
  key: envInput.shape.key,
  value: envInput.shape.value.describe("The value, up to 10000 characters. Omitted from write responses; get_env_vars returns it only when explicitly marked non-secret."),
  target: envTarget,
});
/** One entry per name and target, so a batch cannot contradict itself. */
const envValues = z.array(envValueSchema).max(100).superRefine((entries, ctx) => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const id = entry.key + "\u0000" + entry.target;
    if (seen.has(id)) ctx.addIssue({ code: "custom", path: [index, "key"], message: "Each key and target may appear once." });
    seen.add(id);
  });
});
const envKeys = z.array(envInput.shape.key).min(1).max(100).superRefine((keys, ctx) => {
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Each key may appear once." });
});

async function projectWithConfirmation(userId: string, id: string, confirmation: string) {
  const project = await getProjectForUser(userId, id);
  if (confirmation !== project.name) {
    throw new HttpError(400, "Confirmation must exactly match the project name.", "confirmation_failed");
  }
  return project;
}

/** Names and targets only, in a stable order so the cursor never skips a row. */
export async function apiEnvList(p: Principal, projectIdValue: string, limit = 100, cursor?: string) {
  requireScope(p, "env:read");
  const rows = await listEnvVars(p.userId, projectIdValue);
  const env = rows
    .map(({ key, target }) => ({ key, target }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.target.localeCompare(b.target));
  return { env, ...paginateList(env, { limit, cursor }, (r) => `${r.key}|${r.target}`) };
}

/** Add or replace supplied entries and leave every other name and target alone. */
export async function apiEnvAdd(p: Principal, projectIdValue: string, entries: z.output<typeof envValues>) {
  requireScope(p, "env:write");
  const env = await tagAudit(
    p,
    "env.set",
    () => mergeEnvVars(p.userId, projectIdValue, entries),
    { count: entries.length }
  );
  return { env };
}

/** Replace the whole environment with the supplied list. */
export async function apiEnvSet(
  p: Principal,
  projectIdValue: string,
  confirmation: string,
  entries: z.output<typeof envValues>
) {
  requireScope(p, "env:write");
  const project = await projectWithConfirmation(p.userId, projectIdValue, confirmation);
  const deleted = await tagAudit(
    p,
    "env.replace",
    () => replaceEnvVars(p.userId, project.id, entries),
    { count: entries.length }
  );
  return {
    env: entries.map(({ key, target }) => ({ key, target })),
    deleted,
  };
}

/** Delete the named keys (for one target or every target) and say what went. */
export async function apiEnvDelete(
  p: Principal,
  projectIdValue: string,
  confirmation: string,
  keys: string[],
  target?: "all" | "production" | "preview"
) {
  requireScope(p, "env:write");
  const project = await projectWithConfirmation(p.userId, projectIdValue, confirmation);
  const existing = await listEnvVars(p.userId, project.id);
  const removed = existing.filter((entry) => keys.includes(entry.key) && (target === undefined || entry.target === target));
  for (const key of keys) {
    if (!removed.some((entry) => entry.key === key)) throw notFound("Environment variable not found");
  }
  await tagAudit(
    p,
    "env.delete",
    async () => {
      for (const entry of removed) await deleteEnvVar(p.userId, project.id, entry.id);
    },
    { names: keys.join(", "), target: target ?? "all" }
  );
  return { deleted: removed.map(({ key, target: deletedTarget }) => ({ key, target: deletedTarget })) };
}

export const ENV_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "list_env_vars",
    method: "GET",
    path: "/projects/{projectId}/env",
    scope: "env:read",
    bucket: "read",
    tag: "Environment",
    summary: "List environment variable names",
    // Only validated names and fixed targets come back; no remote bytes.
    untrusted: false,
    description: `List the names and targets (all, production or preview) of a project's environment variables, ordered by name then target. Values marked secret are never returned; get_env_vars returns values only for variables explicitly marked non-secret. Pass limit and then the returned nextCursor as cursor to page through them; items is the page, total is the number of entries, and env keeps the full list for older callers. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId },
    query: {
      limit: z.coerce.number().int().min(1).max(100).default(100).describe("How many entries in a page, 1 to 100. Default 100."),
      cursor: z.string().max(200).optional().describe("The nextCursor of the previous page. Omit for the first page."),
    },
    response: z.object({
      env: z.array(envEntrySchema).describe("All the names and targets, unchanged for callers from before pagination."),
      items: z.array(envEntrySchema).describe("This page of entries, in the same order as env."),
      total: z.number().int().describe("Number of entries in all."),
      nextCursor: z.string().nullable().describe("Pass as cursor for the next page, or null on the last page."),
    }),
    errors: [400, 404],
    run: (p, i) => apiEnvList(p, i.projectId, i.limit, i.cursor),
  }),
  endpoint({
    id: "add_env_vars",
    method: "POST",
    path: "/projects/{projectId}/env",
    scope: "env:write",
    bucket: "write",
    sensitive: true,
    tag: "Environment",
    summary: "Merge environment variables",
    description: "Add or replace the supplied project variables while leaving other names and targets unchanged. Values are encrypted at rest and omitted from write responses; get_env_vars returns them only when explicitly marked non-secret. Each variable reaches the app on the next deploy.",
    pathParams: { projectId },
    body: { envVars: envValues },
    response: z.object({ env: z.array(envEntrySchema) }),
    errors: [400, 404],
    maxBodyBytes: 1_048_576,
    run: (p, i) => apiEnvAdd(p, i.projectId, i.envVars),
  }),
  endpoint({
    id: "set_env_vars",
    method: "PUT",
    path: "/projects/{projectId}/env",
    scope: "env:write",
    bucket: "write",
    sensitive: true,
    tag: "Environment",
    summary: "Replace all environment variables",
    description: "Replace every variable and target on the project with the supplied list. Omitted names are deleted. Existing secret flags stay with matching names and targets; new variables default to secret. Secret values cannot be read or round-tripped. Requires confirmName to exactly match the project name.",
    pathParams: { projectId },
    body: { envVars: envValues, confirmName },
    response: z.object({ env: z.array(envEntrySchema), deleted: z.array(envEntrySchema) }),
    errors: [400, 404],
    destructive: true,
    maxBodyBytes: 1_048_576,
    run: (p, i) => apiEnvSet(p, i.projectId, i.confirmName, i.envVars),
  }),
  endpoint({
    id: "delete_env_vars",
    method: "DELETE",
    path: "/projects/{projectId}/env",
    scope: "env:write",
    bucket: "write",
    sensitive: true,
    tag: "Environment",
    summary: "Delete environment variables",
    description: "Remove every target for the named keys, or only the selected target. Requires confirmName to exactly match the project name. Values are never returned.",
    pathParams: { projectId },
    body: {
      keys: envKeys,
      confirmName,
      target: envTarget.removeDefault().optional(),
    },
    response: z.object({ deleted: z.array(envEntrySchema) }),
    errors: [400, 404],
    destructive: true,
    run: (p, i) => apiEnvDelete(p, i.projectId, i.confirmName, i.keys, i.target),
  }),
];

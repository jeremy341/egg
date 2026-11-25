import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { open } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { endpoint, NOT_FOUND_NOTE, projectIdInput, type Endpoint } from "@/server/api-v1-kit";
import { requireScope, type Principal } from "@/server/api-tokens";
import { tagAudit } from "@/server/api-v1-audit";
import { envInput, getProjectAtLevel, setEnvVarSecret } from "@/server/projects";
import { notFound } from "@/server/http";

const projectId = projectIdInput;
const key = envInput.shape.key;
const target = envInput.shape.target;
const secret = z.boolean().describe("Whether the value stays secret. Only explicitly non-secret values are returned.");
const envVarSchema = z.object({
  key,
  target,
  secret,
  value: envInput.shape.value.optional().describe("Present only when secret is false."),
});

export async function apiGetEnvVars(p: Principal, projectIdValue: string) {
  requireScope(p, "env:read");
  const project = await getProjectAtLevel(p.userId, projectIdValue, "view");
  const db = await getDb();
  const rows = await db
    .select({ key: schema.envVars.key, target: schema.envVars.target, secret: schema.envVars.secret, valueEnc: schema.envVars.valueEnc })
    .from(schema.envVars)
    .where(eq(schema.envVars.projectId, project.id))
    .orderBy(schema.envVars.key, schema.envVars.target);

  const env = rows.map(({ key: name, target: deployTarget, secret: isSecret, valueEnc }) => ({
    key: name,
    target: deployTarget,
    secret: isSecret,
    ...(!isSecret ? { value: open(valueEnc, `env:${project.id}:${name}:${deployTarget}`) } : {}),
  }));
  return { env };
}

export async function apiSetEnvVarSecret(
  p: Principal,
  projectIdValue: string,
  keyValue: string,
  targetValue: "all" | "production" | "preview",
  secretValue: boolean,
) {
  requireScope(p, "env:write");
  const env = await tagAudit(
    p,
    "env.secret",
    () => setEnvVarSecret(p.userId, projectIdValue, keyValue, targetValue, secretValue),
    { name: keyValue, target: targetValue, secret: secretValue },
  );
  return { env };
}

export const ENV_PLAIN_VALUES_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "get_env_vars",
    method: "GET",
    path: "/projects/{projectId}/env/values",
    scope: "env:read",
    bucket: "read",
    tag: "Environment",
    summary: "Read environment variable values marked non-secret",
    description: `Read environment variable names, targets and secret flags, with values only for variables explicitly marked non-secret. Secret values are never returned by any endpoint. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId },
    response: z.object({ env: z.array(envVarSchema) }),
    errors: [404],
    run: (p, i) => apiGetEnvVars(p, i.projectId),
  }),
  endpoint({
    id: "set_env_var_secret",
    method: "PATCH",
    path: "/projects/{projectId}/env/{key}/{target}/secret",
    scope: "env:write",
    bucket: "write",
    tag: "Environment",
    summary: "Change an environment variable's secret flag",
    description: `Change the secret flag for one environment variable and deployment target. Set secret to false to permit get_env_vars to return its value; every value setting leaves this flag unchanged. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId, key, target },
    body: { secret },
    response: z.object({ env: z.object({ key, target, secret }) }),
    errors: [404],
    run: (p, i) => apiSetEnvVarSecret(p, i.projectId, i.key, i.target, i.secret),
  }),
];

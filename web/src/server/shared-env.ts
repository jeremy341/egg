import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { assertOwned, deleteEnvVar, listEnvVars, revealEnvVar, setEnvVar } from "@/server/projects";
import { HttpError } from "@/server/http";

export type SharedEnvironment = "all" | "production" | "preview";

function validateEnvironment(value: unknown): asserts value is SharedEnvironment {
  if (value !== "all" && value !== "production" && value !== "preview") {
    throw new HttpError(400, "Environment must be all, production, or preview.", "invalid_environment");
  }
}

/** Return decrypted shared values to the project owner only. */
export async function listSharedEnv(userId: string, projectId: string, environment: SharedEnvironment) {
  validateEnvironment(environment);
  const project = await assertOwned(userId, projectId);
  const entries = await listEnvVars(userId, project.id);
  const scoped = entries.filter((entry) => entry.target === environment);
  return Promise.all(scoped.map(async ({ key, target }) => ({
    key,
    value: await revealEnvVar(project.id, key, target),
    environment: target,
  })));
}

/** Store one encrypted value in the existing environment-variable vault. */
export async function setSharedEnv(userId: string, projectId: string, environment: SharedEnvironment, key: string, value: string) {
  validateEnvironment(environment);
  await assertOwned(userId, projectId);
  await setEnvVar(userId, projectId, { key, value, target: environment });
  return { key, environment };
}

/** Delete one value from the selected environment. */
export async function deleteSharedEnv(userId: string, projectId: string, environment: SharedEnvironment, key: string) {
  validateEnvironment(environment);
  const project = await assertOwned(userId, projectId);
  const db = await getDb();
  const row = await db.select({ id: schema.envVars.id }).from(schema.envVars).where(and(
    eq(schema.envVars.projectId, project.id),
    eq(schema.envVars.key, key),
    eq(schema.envVars.target, environment),
  )).get();
  if (!row) throw new HttpError(404, "Shared environment value not found.", "not_found");
  await deleteEnvVar(userId, projectId, row.id);
  return { key, environment };
}

import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { assertAccountCanWrite } from "@/server/account-standing";
import { audit } from "@/server/audit";
import { newId, open, seal } from "@/server/crypto";
import { getDb, schema, withLockRetry } from "@/server/db";
import { HttpError, notFound } from "@/server/http";
import { envInput } from "@/server/projects";

export const ENVIRONMENT_SET_LIMIT = 100;
export const SHARED_ENV_VAR_LIMIT = 100;

export const environmentSetInput = z.object({
  name: z.string().trim().min(1, "Give the environment a name.").max(100),
}).strict();

export const environmentSetIdInput = z.string().trim().min(1).max(100);

export type EnvironmentSet = Pick<typeof schema.sharedEnvSets.$inferSelect, "id" | "name" | "isDefault">;
export type SharedVariable = { id: string; key: string; target: "all" | "production" | "preview" };

const variableBatchInput = z.array(envInput).max(SHARED_ENV_VAR_LIMIT).superRefine((entries, ctx) => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const key = entry.key + "\u0000" + entry.target;
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: [index, "key"], message: "Each key and target may appear once." });
    seen.add(key);
  });
});

const variableDeleteInput = z.object({
  keys: z.array(envInput.shape.key).min(1).max(SHARED_ENV_VAR_LIMIT).superRefine((keys, ctx) => {
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Each key may appear once." });
  }),
  target: envInput.shape.target.removeDefault().optional(),
}).strict();

async function findEnvironmentSet(userId: string, setId: string) {
  const db = await getDb();
  const row = await db.select().from(schema.sharedEnvSets).where(and(
    eq(schema.sharedEnvSets.id, setId),
    eq(schema.sharedEnvSets.userId, userId),
  )).get();
  if (!row) throw notFound("Environment not found");
  return row;
}

export async function listEnvironmentSets(userId: string): Promise<EnvironmentSet[]> {
  const db = await getDb();
  return db.select({ id: schema.sharedEnvSets.id, name: schema.sharedEnvSets.name, isDefault: schema.sharedEnvSets.isDefault })
    .from(schema.sharedEnvSets)
    .where(eq(schema.sharedEnvSets.userId, userId))
    .orderBy(schema.sharedEnvSets.name);
}

export async function createEnvironmentSet(userId: string, raw: unknown): Promise<EnvironmentSet> {
  const input = environmentSetInput.parse(raw);
  const db = await getDb();
  const row = await withLockRetry(() => db.transaction(async (tx) => {
    await assertAccountCanWrite(userId, { db: tx });
    const existing = await tx.select({ id: schema.sharedEnvSets.id })
      .from(schema.sharedEnvSets)
      .where(eq(schema.sharedEnvSets.userId, userId));
    if (existing.length >= ENVIRONMENT_SET_LIMIT) {
      throw new HttpError(400, `An account can have up to ${ENVIRONMENT_SET_LIMIT} environments.`, "limit");
    }
    const sameName = await tx.select({ id: schema.sharedEnvSets.id }).from(schema.sharedEnvSets).where(and(
      eq(schema.sharedEnvSets.userId, userId),
      eq(schema.sharedEnvSets.name, input.name),
    )).get();
    if (sameName) throw new HttpError(409, "An environment with that name already exists.", "duplicate_name");

    const now = new Date();
    const [created] = await tx.insert(schema.sharedEnvSets).values({
      id: newId(),
      userId,
      name: input.name,
      isDefault: existing.length === 0,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: schema.sharedEnvSets.id, name: schema.sharedEnvSets.name, isDefault: schema.sharedEnvSets.isDefault });
    if (!created) throw new Error("Environment creation returned no row");
    return created;
  }));
  await audit(userId, "env.sets.create", row.id, { name: row.name });
  return row;
}

export async function renameEnvironmentSet(userId: string, setId: string, raw: unknown): Promise<EnvironmentSet> {
  const input = environmentSetInput.parse(raw);
  const db = await getDb();
  const renamed = await withLockRetry(() => db.transaction(async (tx) => {
    await assertAccountCanWrite(userId, { db: tx });
    const current = await tx.select().from(schema.sharedEnvSets).where(and(
      eq(schema.sharedEnvSets.id, setId),
      eq(schema.sharedEnvSets.userId, userId),
    )).get();
    if (!current) throw notFound("Environment not found");
    const sameName = await tx.select({ id: schema.sharedEnvSets.id }).from(schema.sharedEnvSets).where(and(
      eq(schema.sharedEnvSets.userId, userId),
      eq(schema.sharedEnvSets.name, input.name),
      ne(schema.sharedEnvSets.id, setId),
    )).get();
    if (sameName) throw new HttpError(409, "An environment with that name already exists.", "duplicate_name");
    const [row] = await tx.update(schema.sharedEnvSets)
      .set({ name: input.name, updatedAt: new Date() })
      .where(and(eq(schema.sharedEnvSets.id, setId), eq(schema.sharedEnvSets.userId, userId)))
      .returning({ id: schema.sharedEnvSets.id, name: schema.sharedEnvSets.name, isDefault: schema.sharedEnvSets.isDefault });
    if (!row) throw notFound("Environment not found");
    return row;
  }));
  await audit(userId, "env.sets.rename", setId, { name: renamed.name });
  return renamed;
}

export async function deleteEnvironmentSet(userId: string, setId: string, confirmName: string): Promise<{ id: string; name: string }> {
  const db = await getDb();
  const deleted = await withLockRetry(() => db.transaction(async (tx) => {
    await assertAccountCanWrite(userId, { db: tx });
    const row = await tx.select().from(schema.sharedEnvSets).where(and(
      eq(schema.sharedEnvSets.id, setId),
      eq(schema.sharedEnvSets.userId, userId),
    )).get();
    if (!row) throw notFound("Environment not found");
    if (confirmName !== row.name) throw new HttpError(400, "Confirmation must exactly match the environment name.", "confirmation_failed");
    await tx.delete(schema.sharedEnvSets).where(eq(schema.sharedEnvSets.id, row.id));
    return { id: row.id, name: row.name };
  }));
  await audit(userId, "env.sets.delete", deleted.id, { name: deleted.name });
  return deleted;
}

export async function setDefaultEnvironmentSet(userId: string, setId: string): Promise<EnvironmentSet> {
  const db = await getDb();
  const selected = await withLockRetry(() => db.transaction(async (tx) => {
    await assertAccountCanWrite(userId, { db: tx });
    const current = await tx.select().from(schema.sharedEnvSets).where(and(
      eq(schema.sharedEnvSets.id, setId),
      eq(schema.sharedEnvSets.userId, userId),
    )).get();
    if (!current) throw notFound("Environment not found");
    const now = new Date();
    await tx.update(schema.sharedEnvSets).set({ isDefault: false, updatedAt: now })
      .where(and(eq(schema.sharedEnvSets.userId, userId), eq(schema.sharedEnvSets.isDefault, true)));
    const [row] = await tx.update(schema.sharedEnvSets).set({ isDefault: true, updatedAt: now }).where(and(
      eq(schema.sharedEnvSets.id, setId),
      eq(schema.sharedEnvSets.userId, userId),
    )).returning({ id: schema.sharedEnvSets.id, name: schema.sharedEnvSets.name, isDefault: schema.sharedEnvSets.isDefault });
    if (!row) throw notFound("Environment not found");
    return row;
  }));
  await audit(userId, "env.sets.default", selected.id, { name: selected.name });
  return selected;
}

export async function listSharedEnvironmentVariables(userId: string, setId: string): Promise<SharedVariable[]> {
  await findEnvironmentSet(userId, setId);
  const db = await getDb();
  // Values stay write-only, matching the project variable API.
  return db.select({ id: schema.sharedEnvVars.id, key: schema.sharedEnvVars.key, target: schema.sharedEnvVars.target })
    .from(schema.sharedEnvVars)
    .where(eq(schema.sharedEnvVars.setId, setId))
    .orderBy(schema.sharedEnvVars.key, schema.sharedEnvVars.target);
}

export async function mergeSharedEnvironmentVariables(userId: string, setId: string, raw: unknown): Promise<Array<{ key: string; target: "all" | "production" | "preview" }>> {
  const entries = variableBatchInput.parse(raw);
  const environment = await findEnvironmentSet(userId, setId);
  const db = await getDb();
  await withLockRetry(() => db.transaction(async (tx) => {
    await assertAccountCanWrite(userId, { db: tx });
    const environmentSet = await tx.select({ id: schema.sharedEnvSets.id })
      .from(schema.sharedEnvSets)
      .where(and(eq(schema.sharedEnvSets.id, setId), eq(schema.sharedEnvSets.userId, userId)))
      .get();
    if (!environmentSet) throw notFound("Environment not found");
    const existing = await tx.select({ key: schema.sharedEnvVars.key, target: schema.sharedEnvVars.target })
      .from(schema.sharedEnvVars)
      .where(eq(schema.sharedEnvVars.setId, setId));
    const currentKeys = new Set(existing.map((entry) => entry.key + "\u0000" + entry.target));
    const added = entries.filter((entry) => !currentKeys.has(entry.key + "\u0000" + entry.target)).length;
    if (existing.length + added > SHARED_ENV_VAR_LIMIT) {
      throw new HttpError(400, `An environment can have up to ${SHARED_ENV_VAR_LIMIT} variables.`, "limit");
    }
    for (const entry of entries) {
      const valueEnc = seal(entry.value, `shared-env:${setId}:${entry.key}:${entry.target}`);
      await tx.insert(schema.sharedEnvVars).values({
        id: newId(),
        setId,
        key: entry.key,
        valueEnc,
        target: entry.target,
        createdAt: new Date(),
      }).onConflictDoUpdate({
        target: [schema.sharedEnvVars.setId, schema.sharedEnvVars.key, schema.sharedEnvVars.target],
        set: { valueEnc },
      });
    }
  }));
  await audit(userId, "env.sets.variables.set", setId, { name: environment.name, count: entries.length });
  return entries.map(({ key, target }) => ({ key, target }));
}

export async function replaceSharedEnvironmentVariables(
  userId: string,
  setId: string,
  confirmName: string,
  raw: unknown,
): Promise<{ env: Array<{ key: string; target: "all" | "production" | "preview" }>; deleted: Array<{ key: string; target: "all" | "production" | "preview" }> }> {
  const entries = variableBatchInput.parse(raw);
  const db = await getDb();
  const result = await withLockRetry(() => db.transaction(async (tx) => {
    await assertAccountCanWrite(userId, { db: tx });
    const environment = await tx.select({ name: schema.sharedEnvSets.name })
      .from(schema.sharedEnvSets)
      .where(and(eq(schema.sharedEnvSets.id, setId), eq(schema.sharedEnvSets.userId, userId)))
      .get();
    if (!environment) throw notFound("Environment not found");
    if (confirmName !== environment.name) throw new HttpError(400, "Confirmation must exactly match the environment name.", "confirmation_failed");
    const existing = await tx.select({ key: schema.sharedEnvVars.key, target: schema.sharedEnvVars.target })
      .from(schema.sharedEnvVars)
      .where(eq(schema.sharedEnvVars.setId, setId));
    const desired = new Set(entries.map((entry) => entry.key + "\u0000" + entry.target));
    const removed = existing.filter((entry) => !desired.has(entry.key + "\u0000" + entry.target));
    await tx.delete(schema.sharedEnvVars).where(eq(schema.sharedEnvVars.setId, setId));
    if (entries.length) {
      const createdAt = new Date();
      await tx.insert(schema.sharedEnvVars).values(entries.map((entry) => ({
        id: newId(),
        setId,
        key: entry.key,
        valueEnc: seal(entry.value, `shared-env:${setId}:${entry.key}:${entry.target}`),
        target: entry.target,
        createdAt,
      })));
    }
    return { name: environment.name, deleted: removed };
  }));
  await audit(userId, "env.sets.variables.replace", setId, { name: result.name, count: entries.length, deleted: result.deleted.length });
  return {
    env: entries.map(({ key, target }) => ({ key, target })),
    deleted: result.deleted,
  };
}

export async function deleteSharedEnvironmentVariables(
  userId: string,
  setId: string,
  confirmName: string,
  raw: unknown,
): Promise<Array<{ key: string; target: "all" | "production" | "preview" }>> {
  const input = variableDeleteInput.parse(raw);
  const db = await getDb();
  const result = await withLockRetry(() => db.transaction(async (tx) => {
    await assertAccountCanWrite(userId, { db: tx });
    const environment = await tx.select({ name: schema.sharedEnvSets.name })
      .from(schema.sharedEnvSets)
      .where(and(eq(schema.sharedEnvSets.id, setId), eq(schema.sharedEnvSets.userId, userId)))
      .get();
    if (!environment) throw notFound("Environment not found");
    if (confirmName !== environment.name) throw new HttpError(400, "Confirmation must exactly match the environment name.", "confirmation_failed");
    const existing = await tx.select({ id: schema.sharedEnvVars.id, key: schema.sharedEnvVars.key, target: schema.sharedEnvVars.target })
      .from(schema.sharedEnvVars)
      .where(eq(schema.sharedEnvVars.setId, setId));
    const rows = existing.filter((entry) => input.keys.includes(entry.key) && (input.target === undefined || entry.target === input.target));
    for (const key of input.keys) {
      if (!rows.some((entry) => entry.key === key)) throw notFound("Shared environment variable not found");
    }
    if (rows.length) await tx.delete(schema.sharedEnvVars).where(and(
      eq(schema.sharedEnvVars.setId, setId),
      inArray(schema.sharedEnvVars.id, rows.map((entry) => entry.id)),
    ));
    return { name: environment.name, deleted: rows.map(({ key, target }) => ({ key, target })) };
  }));
  await audit(userId, "env.sets.variables.delete", setId, { name: result.name, count: result.deleted.length, target: input.target ?? "all" });
  return result.deleted;
}

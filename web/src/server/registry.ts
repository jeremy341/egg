import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { newId, open, seal } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { isUniqueViolation } from "@/server/db/errors";
import { checkImageRef } from "@/server/projects";
import { parseImageRef, registryHostError } from "@/server/deploy/image-ref";
import { HttpError, notFound } from "@/server/http";

/**
 * Registry logins for private container images. A login belongs to its owner and is used by any of
 * the owner's image apps whose reference is on the same registry host. The username and password are
 * sealed with the instance key. No function in this module returns the password, and the sealed
 * values are never returned either.
 */

const secretText = (max: number, label: string) =>
  z
    .string()
    .min(1, `Enter the ${label}.`)
    .max(max)
    .refine((v) => !/[\r\n\0]/.test(v), `The ${label} cannot contain line breaks.`);

const credentialFields = {
  host: z.string().trim().min(1).max(261),
  username: secretText(200, "username"),
  password: secretText(1000, "password"),
};

export const registryCreateInput = z.object(credentialFields);
export const registryUpdateInput = z
  .object({ username: credentialFields.username.optional(), password: credentialFields.password.optional() })
  .refine((v) => v.username !== undefined || v.password !== undefined, "Nothing to change");

export const imageSourceInput = z.object({
  imageRef: z.string().trim().min(1).max(255),
  /** The login to pull with, or null for a public image. */
  registryCredentialId: z.string().min(1).max(64).nullable().optional(),
  pullPolicy: z.enum(["auto", "always", "cached"]).optional(),
});

const usernameContext = (userId: string, id: string) => `registry:${userId}:${id}:username`;
const passwordContext = (userId: string, id: string) => `registry:${userId}:${id}:password`;

function normalizeHost(raw: string): string {
  const error = registryHostError(raw);
  if (error) throw new HttpError(400, error, "validation");
  return raw.trim().toLowerCase();
}

/** The safe view of a login: host, username and which apps use it. Never the password. */
async function viewOf(userId: string, row: typeof schema.registryCredentials.$inferSelect, usedBy: { id: string; name: string }[]) {
  return {
    id: row.id,
    host: row.host,
    username: open(row.usernameEnc, usernameContext(userId, row.id)),
    usedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function usersOf(userId: string, credentialIds: string[]) {
  const db = await getDb();
  const map = new Map<string, { id: string; name: string }[]>();
  if (credentialIds.length === 0) return map;
  const rows = await db
    .select({ id: schema.projects.id, name: schema.projects.name, credentialId: schema.projects.registryCredentialId })
    .from(schema.projects)
    .where(and(eq(schema.projects.userId, userId), inArray(schema.projects.registryCredentialId, credentialIds)));
  for (const r of rows) {
    if (!r.credentialId) continue;
    map.set(r.credentialId, [...(map.get(r.credentialId) ?? []), { id: r.id, name: r.name }]);
  }
  return map;
}

export async function listRegistryCredentials(userId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.registryCredentials)
    .where(eq(schema.registryCredentials.userId, userId))
    .orderBy(schema.registryCredentials.host);
  const used = await usersOf(userId, rows.map((r) => r.id));
  return Promise.all(rows.map((r) => viewOf(userId, r, used.get(r.id) ?? [])));
}

export async function createRegistryCredential(userId: string, raw: unknown) {
  const input = registryCreateInput.parse(raw);
  const host = normalizeHost(input.host);
  const db = await getDb();
  const id = newId();
  const now = new Date();
  try {
    await db.insert(schema.registryCredentials).values({
      id,
      userId,
      host,
      usernameEnc: seal(input.username, usernameContext(userId, id)),
      passwordEnc: seal(input.password, passwordContext(userId, id)),
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, `You already have a login for ${host}. Edit that one instead.`, "conflict");
    throw err;
  }
  await audit(userId, "registry.create", null, { host });
  const row = await db.select().from(schema.registryCredentials).where(eq(schema.registryCredentials.id, id)).get();
  return viewOf(userId, row!, []);
}

async function ownedCredential(userId: string, id: string) {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.registryCredentials)
    .where(and(eq(schema.registryCredentials.id, id), eq(schema.registryCredentials.userId, userId)))
    .get();
  if (!row) throw notFound("Registry login not found");
  return row;
}

/** Change the username, the password, or both. The old values are replaced; nothing is returned. */
export async function updateRegistryCredential(userId: string, id: string, raw: unknown) {
  const input = registryUpdateInput.parse(raw);
  const row = await ownedCredential(userId, id);
  const db = await getDb();
  await db
    .update(schema.registryCredentials)
    .set({
      ...(input.username !== undefined ? { usernameEnc: seal(input.username, usernameContext(userId, id)) } : {}),
      ...(input.password !== undefined ? { passwordEnc: seal(input.password, passwordContext(userId, id)) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.registryCredentials.id, row.id));
  await audit(userId, "registry.update", null, { host: row.host, fields: [input.username !== undefined && "username", input.password !== undefined && "password"].filter(Boolean).join(", ") });
  const fresh = await db.select().from(schema.registryCredentials).where(eq(schema.registryCredentials.id, id)).get();
  return viewOf(userId, fresh!, (await usersOf(userId, [id])).get(id) ?? []);
}

/**
 * Remove a login. Refused while any of the owner's apps still uses it: the refusal names those apps,
 * so the owner can point them at another login, or at none, and try again.
 */
export async function removeRegistryCredential(userId: string, id: string) {
  const row = await ownedCredential(userId, id);
  const users = (await usersOf(userId, [id])).get(id) ?? [];
  if (users.length > 0) {
    const names = users.map((u) => u.name).join(", ");
    throw new HttpError(409, `This login is used by ${names}. Point ${users.length === 1 ? "that app" : "those apps"} at another login, or at none, before you remove it.`, "conflict");
  }
  const db = await getDb();
  await db.delete(schema.registryCredentials).where(eq(schema.registryCredentials.id, row.id));
  await audit(userId, "registry.remove", null, { host: row.host });
}

/**
 * The login for a pull, decrypted. Only the deploy step calls this, and it never goes back to a client.
 */
export async function registryLoginFor(userId: string, id: string): Promise<{ host: string; username: string; password: string }> {
  const row = await ownedCredential(userId, id);
  return {
    host: row.host,
    username: open(row.usernameEnc, usernameContext(userId, id)),
    password: open(row.passwordEnc, passwordContext(userId, id)),
  };
}

/**
 * Set the image an image app runs, and which login pulls it. The login must be for the image's own host,
 * so a token for one registry is never sent to another.
 */
export async function updateImageSource(userId: string, projectId: string, raw: unknown) {
  const input = imageSourceInput.parse(raw);
  const db = await getDb();
  const project = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();
  if (!project) throw notFound("Project not found");
  if (project.deploymentMode !== "image") throw new HttpError(400, "Only an image app has an image to update.", "validation");

  const imageRef = checkImageRef(input.imageRef);
  const parsed = parseImageRef(imageRef);
  if (!parsed.ok) throw new HttpError(400, parsed.reason, "validation");

  let credentialId: string | null = null;
  if (input.registryCredentialId) {
    const login = await ownedCredential(userId, input.registryCredentialId);
    if (login.host !== parsed.ref.host) {
      throw new HttpError(400, `That login is for ${login.host}, but the image is on ${parsed.ref.host}.`, "validation");
    }
    credentialId = login.id;
  }

  await db
    .update(schema.projects)
    .set({
      imageRef,
      registryCredentialId: credentialId,
      ...(input.pullPolicy !== undefined ? { pullPolicy: input.pullPolicy } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, project.id));
  await audit(userId, "project.image", project.id, { host: parsed.ref.host, private: credentialId !== null });
  return { imageRef, host: parsed.ref.host, registryCredentialId: credentialId };
}

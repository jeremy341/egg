import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { newId, open, seal } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http";
import { createProviderApi, type ProviderResolver, type ProviderTransport } from "./api";

type Kind = "gitlab" | "forgejo" | "codeberg";
type Dependencies = { resolve?: ProviderResolver; transport?: ProviderTransport };
const inputSchema = z.object({ provider: z.enum(["gitlab", "forgejo", "codeberg"]), label: z.string().trim().min(1).max(100), host: z.string().url().max(500), accessToken: z.string().min(1).max(4096).refine((v) => !/[\r\n\u0000]/.test(v)) });
const publicConnection = (row: typeof schema.providerConnections.$inferSelect) => ({ id: row.id, provider: row.provider, label: row.label, host: row.host, createdAt: row.createdAt });
const context = (userId: string, id: string, provider: Kind) => `provider-token:${userId}:${id}:${provider}`;

export async function createConnection(userId: string, raw: unknown, deps: Dependencies = {}) {
  const input = inputSchema.parse(raw);
  let host: string;
  try { host = new URL(input.host).origin; } catch { throw new HttpError(400, "Invalid provider URL.", "validation"); }
  const api = (() => { try { return createProviderApi({ kind: input.provider, instance: input.host, headers: { authorization: `Bearer ${input.accessToken}` }, ...deps }); } catch { throw new HttpError(400, "Invalid provider URL.", "validation"); } })();
  // Contact the pinned instance before saving the credential; failed and private DNS answers are rejected.
  try { await api.listRepositories(1); } catch { throw new HttpError(400, "Could not connect to the provider with these credentials.", "validation"); }
  const id = newId(); const row = { id, userId, provider: input.provider, label: input.label, host, tokenEnc: seal(input.accessToken, context(userId, id, input.provider)), createdAt: new Date() };
  await (await getDb()).insert(schema.providerConnections).values(row);
  return publicConnection(row);
}
export async function listConnections(userId: string) {
  const db = await getDb();
  const [rows, counts] = await Promise.all([
    db.select().from(schema.providerConnections).where(eq(schema.providerConnections.userId, userId)),
    db.select({ id: schema.projects.providerConnectionId, count: sql<number>`count(*)` }).from(schema.projects).where(eq(schema.projects.userId, userId)).groupBy(schema.projects.providerConnectionId),
  ]);
  const byId = new Map(counts.map((entry) => [entry.id, entry.count]));
  return rows.map((row) => ({ ...publicConnection(row), projectCount: byId.get(row.id) ?? 0 }));
}
export async function deleteConnection(userId: string, id: string, detach = false) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const row = await tx.select().from(schema.providerConnections).where(and(eq(schema.providerConnections.id, id), eq(schema.providerConnections.userId, userId))).get();
    if (!row) throw notFound("Connection not found");
    const used = await tx.select({ count: sql<number>`count(*)` }).from(schema.projects).where(eq(schema.projects.providerConnectionId, id)).get();
    const count = used?.count ?? 0;
    if (count && !detach) throw new HttpError(409, `This connection is used by ${count} project${count === 1 ? "" : "s"}. Detach those projects before disconnecting.`, "conflict");
    if (count) await tx.update(schema.projects).set({ providerConnectionId: null, autoDeploy: false, providerWebhookSecretEnc: null, updatedAt: new Date() }).where(eq(schema.projects.providerConnectionId, id));
    await tx.delete(schema.providerConnections).where(and(eq(schema.providerConnections.id, id), eq(schema.providerConnections.userId, userId)));
    await tx.insert(schema.auditLog).values({ userId, action: "provider.disconnect", target: id, meta: JSON.stringify({ detachedProjects: count }), at: new Date() });
    return { disconnected: true as const, detachedProjects: count };
  });
}
export async function providerClientForUser(userId: string, id: string, provider: Kind, deps: Dependencies = {}) {
  const row = await (await getDb()).select().from(schema.providerConnections).where(and(eq(schema.providerConnections.id, id), eq(schema.providerConnections.userId, userId), eq(schema.providerConnections.provider, provider))).get();
  if (!row) throw notFound("Connection not found");
  const token = open(row.tokenEnc, context(userId, row.id, row.provider));
  return createProviderApi({ kind: row.provider, instance: row.host, headers: { authorization: `Bearer ${token}` }, ...deps });
}

export function publicProviderClient(provider: Kind, repoUrl: string, deps: Dependencies = {}) {
  let url: URL;
  try { url = new URL(repoUrl); } catch { throw new HttpError(400, "Invalid repository URL.", "validation"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\/?$/.test(url.pathname)) throw new HttpError(400, "Invalid repository URL.", "validation");
  try { return createProviderApi({ kind: provider, instance: url.origin, ...deps }); }
  catch { throw new HttpError(400, "Invalid provider URL.", "validation"); }
}

export function repositoryNameFromUrl(repoUrl: string): string {
  let url: URL;
  try { url = new URL(repoUrl); } catch { throw new HttpError(400, "Invalid repository URL.", "validation"); }
  return url.pathname.replace(/^\//, "").replace(/\/$/, "").replace(/\.git$/, "");
}

export async function validateProviderSource(api: Pick<ReturnType<typeof createProviderApi>, "getRepository" | "branchCommit">, input: { repoFullName: string; repoUrl: string; productionBranch: string }, requirePublic = false): Promise<void> {
  try {
    const repository = await api.getRepository(input.repoFullName);
    if (repository.fullName !== input.repoFullName || repository.cloneUrl.replace(/\.git$/, "") !== input.repoUrl.replace(/\/$/, "").replace(/\.git$/, "") || (requirePublic && repository.private)) throw new Error("Repository mismatch");
    await api.branchCommit(repository.fullName, input.productionBranch);
  } catch { throw new HttpError(400, "The connection cannot access that repository and branch.", "validation"); }
}

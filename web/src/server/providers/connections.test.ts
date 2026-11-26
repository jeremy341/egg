import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { createConnection, deleteConnection, listConnections, providerClientForUser, validateProviderSource, publicProviderClient } from "./connections";
import type { ProviderTransport } from "./api";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let owner: string; let stranger: string;
const resolve = async () => ["93.184.216.34"];
const transport: ProviderTransport = async () => ({ status: 200, body: (async function* () { yield Buffer.from("[]"); })() });
beforeAll(async () => { ctx = await useFreshDb(); owner = (await upsertUser({ id: "provider-owner", name: "owner", email: null, slackId: null })).id; stranger = (await upsertUser({ id: "provider-other", name: "other", email: null, slackId: null })).id; });
afterAll(async () => { await ctx.cleanup(); });
describe("provider connections", () => {
  it("encrypts credentials, returns sanitized records, and isolates ownership", async () => {
    const connection = await createConnection(owner, { provider: "forgejo", label: "Mine", host: "https://git.example.com", accessToken: "secret-token" }, { resolve, transport });
    expect(JSON.stringify(connection)).not.toContain("secret-token");
    const row = await ctx.db.select().from(schema.providerConnections).where(eq(schema.providerConnections.id, connection.id)).get();
    expect(row?.tokenEnc).not.toContain("secret-token");
    expect((await listConnections(stranger))).toEqual([]);
    await expect(providerClientForUser(stranger, connection.id, "forgejo", { resolve, transport })).rejects.toThrow();
    await expect(providerClientForUser(owner, connection.id, "gitlab", { resolve, transport })).rejects.toThrow();
    await deleteConnection(owner, connection.id);
    await expect(providerClientForUser(owner, connection.id, "forgejo", { resolve, transport })).rejects.toThrow();
  });
  it("binds the chosen URL and repository to the authenticated connection", async () => {
    const api = { getRepository: async () => ({ id: 1, fullName: "a/b", cloneUrl: "https://git.example.com/a/b.git", defaultBranch: "main", private: true, pushedAt: null }), branchCommit: async () => "a".repeat(40) };
    await expect(validateProviderSource(api, { repoFullName: "a/b", repoUrl: "https://git.example.com/other/repo.git", productionBranch: "main" })).rejects.toThrow();
    await expect(validateProviderSource(api, { repoFullName: "a/b", repoUrl: "https://git.example.com/a/b.git", productionBranch: "main" })).resolves.toBeUndefined();
  });
  it("permits public provider lookup without a stored token and rejects private repositories", async () => {
    let auth: string | undefined;
    const transport: ProviderTransport = async (req) => { auth = req.headers.authorization; return { status: 200, body: (async function* () { yield Buffer.from(JSON.stringify({ id: 1, full_name: "a/b", clone_url: "https://codeberg.org/a/b.git", private: true, default_branch: "main", pushed_at: null })); })() }; };
    const api = publicProviderClient("codeberg", "https://codeberg.org/a/b.git", { resolve, transport });
    await expect(validateProviderSource(api, { repoFullName: "a/b", repoUrl: "https://codeberg.org/a/b.git", productionBranch: "main" }, true)).rejects.toThrow();
    expect(auth).toBeUndefined();
  });
  it("refuses a connection resolving to private network addresses before storing credentials", async () => {
    await expect(createConnection(owner, { provider: "forgejo", label: "bad", host: "https://git.example.com", accessToken: "secret-token" }, { resolve: async () => ["127.0.0.1"], transport })).rejects.toThrow();
    expect(await listConnections(owner)).toEqual([]);
  });
});



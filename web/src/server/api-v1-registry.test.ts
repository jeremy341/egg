import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal, Scope } from "@/server/api-tokens";
import { callEndpoint } from "@/server/api-v1";
import { REGISTRY_ENDPOINTS } from "@/server/api-v1-registry";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { registryLoginFor, updateImageSource } from "@/server/registry";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let owner: { id: string };
let outsider: { id: string };
let serverId: string;
let nextPort = 9700;

const USER = "deploy-robot";
const PASSWORD = "super-secret-registry-pw";

type CredentialView = {
  id: string;
  host: string;
  username: string;
  usedBy: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
};

const endpoint = (id: string) => {
  const found = REGISTRY_ENDPOINTS.find((candidate) => candidate.id === id);
  expect(found, `endpoint ${id} is registered`).toBeDefined();
  if (!found) throw new Error(`Missing endpoint ${id}`);
  return found;
};

const principal = (userId: string, scopes: Scope[]): Principal => ({ userId, tokenId: "test-token", scopes });

const setCredential = async (p: Principal, host: string, username = USER, password = PASSWORD) =>
  (await callEndpoint(p, endpoint("set_registry_credential"), { host, username, password })) as { credential: CredentialView };

const listCredentials = async (p: Principal) =>
  (await callEndpoint(p, endpoint("list_registry_credentials"), {})) as { credentials: CredentialView[] };

const deleteCredential = async (p: Principal, credentialId: string, confirmName: string) =>
  callEndpoint(p, endpoint("delete_registry_credential"), { credentialId, confirmName });

async function sealedPasswordOf(id: string) {
  const db = await getDb();
  const row = await db.select().from(schema.registryCredentials).where(eq(schema.registryCredentials.id, id)).get();
  return row!.passwordEnc;
}

beforeAll(async () => {
  ctx = await useFreshDb();
  owner = await upsertUser({ id: "registry-api-owner", name: "Owner", email: null, slackId: null });
  outsider = await upsertUser({ id: "registry-api-outsider", name: "Outsider", email: null, slackId: null });
  serverId = (await createServer(owner.id, "registry-api-server")).id;
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("registry credential endpoints", () => {
  it("exposes list, set and delete with the secret scopes and write flags", () => {
    expect(REGISTRY_ENDPOINTS.map((ep) => ep.id)).toEqual([
      "list_registry_credentials",
      "set_registry_credential",
      "delete_registry_credential",
    ]);
    expect(endpoint("list_registry_credentials")).toMatchObject({ method: "GET", scope: "env:read", readOnly: true });
    expect(endpoint("set_registry_credential")).toMatchObject({ method: "PUT", scope: "env:write", readOnly: false });
    expect(endpoint("delete_registry_credential")).toMatchObject({
      method: "DELETE",
      scope: "env:write",
      readOnly: false,
      destructive: true,
    });
  });

  it("requires the endpoint's scope before touching registry data", async () => {
    const p = principal(owner.id, []);
    for (const [id, input] of [
      ["list_registry_credentials", {}],
      ["set_registry_credential", { host: "scope.example.test", username: USER, password: PASSWORD }],
      ["delete_registry_credential", { credentialId: "missing", confirmName: "scope.example.test" }],
    ] as const) {
      await expect(callEndpoint(p, endpoint(id), input), id).rejects.toMatchObject({ status: 403 });
    }
    const reader = principal(owner.id, ["env:read"]);
    await expect(
      callEndpoint(reader, endpoint("set_registry_credential"), { host: "scope.example.test", username: USER, password: PASSWORD })
    ).rejects.toMatchObject({ status: 403 });
    await expect(listCredentials(reader)).resolves.toMatchObject({ credentials: [] });
  });

  it("sets a login, lists it, and never returns the password or its sealed form", async () => {
    const p = principal(owner.id, ["env:read", "env:write"]);
    const { credential } = await setCredential(p, "ghcr.example.test");
    expect(credential).toMatchObject({ host: "ghcr.example.test", username: USER });
    expect(JSON.stringify(credential)).not.toContain(PASSWORD);
    expect(JSON.stringify(credential)).not.toContain("passwordEnc");

    const sealed = await sealedPasswordOf(credential.id);
    expect(sealed).not.toContain(PASSWORD);
    const listed = JSON.stringify(await listCredentials(p));
    expect(listed).toContain("ghcr.example.test");
    expect(listed).not.toContain(PASSWORD);
    expect(listed).not.toContain(sealed);
    expect(listed).not.toContain("passwordEnc");
    // The login really was stored: only the deploy-side helper can open it.
    expect(await registryLoginFor(owner.id, credential.id)).toEqual({
      host: "ghcr.example.test",
      username: USER,
      password: PASSWORD,
    });
  });

  it("replaces the login for the same host instead of adding a second one", async () => {
    const p = principal(owner.id, ["env:read", "env:write"]);
    const first = await setCredential(p, "upsert.example.test");
    const nextPassword = "a-brand-new-password-456";
    const second = await setCredential(p, "UPSERT.example.test", "new-user", nextPassword);
    expect(second.credential.id).toBe(first.credential.id);
    expect(second.credential.username).toBe("new-user");
    expect(JSON.stringify(second)).not.toContain(nextPassword);

    const hosts = (await listCredentials(p)).credentials.filter((c) => c.host === "upsert.example.test");
    expect(hosts).toHaveLength(1);
    expect(await registryLoginFor(owner.id, first.credential.id)).toEqual({
      host: "upsert.example.test",
      username: "new-user",
      password: nextPassword,
    });
  });

  it("refuses a host with a scheme or a password with a line break", async () => {
    const p = principal(owner.id, ["env:write"]);
    await expect(
      callEndpoint(p, endpoint("set_registry_credential"), { host: "https://ghcr.io", username: USER, password: PASSWORD })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      callEndpoint(p, endpoint("set_registry_credential"), { host: "newline.example.test", username: USER, password: "a\nb" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a delete with the wrong confirmation or from another owner", async () => {
    const p = principal(owner.id, ["env:read", "env:write"]);
    const { credential } = await setCredential(p, "confirm.example.test");
    await expect(deleteCredential(p, credential.id, "not-the-host")).rejects.toMatchObject({ status: 400 });
    const other = principal(outsider.id, ["env:write"]);
    await expect(deleteCredential(other, credential.id, "confirm.example.test")).rejects.toMatchObject({ status: 404 });
    await expect(deleteCredential(p, credential.id, "confirm.example.test")).resolves.toMatchObject({
      deleted: true,
      credentialId: credential.id,
    });
    expect((await listCredentials(p)).credentials.some((c) => c.id === credential.id)).toBe(false);
  });

  it("refuses to delete a login an image app uses, then allows it once the app is pointed away", async () => {
    const p = principal(owner.id, ["env:read", "env:write"]);
    const { credential } = await setCredential(p, "private.example.test");
    const imageRef = "private.example.test/owner/web:1.0.0";
    const app = await createProject(owner.id, {
      serverId,
      name: "Private Web",
      deploymentMode: "image",
      imageRef,
      repoUrl: "",
      port: nextPort++,
    });
    await updateImageSource(owner.id, app.id, { imageRef, registryCredentialId: credential.id });

    const listed = (await listCredentials(p)).credentials.find((c) => c.id === credential.id);
    expect(listed?.usedBy).toEqual([{ id: app.id, name: "Private Web" }]);
    await expect(deleteCredential(p, credential.id, "private.example.test")).rejects.toMatchObject({ status: 409 });

    await updateImageSource(owner.id, app.id, { imageRef, registryCredentialId: null });
    await expect(deleteCredential(p, credential.id, "private.example.test")).resolves.toMatchObject({ deleted: true });
    expect((await listCredentials(p)).credentials.some((c) => c.id === credential.id)).toBe(false);
  });
});

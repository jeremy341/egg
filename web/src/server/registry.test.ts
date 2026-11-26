import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { createProject, updateProject } from "@/server/projects";
import {
  createRegistryCredential,
  listRegistryCredentials,
  registryLoginFor,
  removeRegistryCredential,
  updateImageSource,
  updateRegistryCredential,
} from "@/server/registry";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let serverId: string;
let nextPort = 9500;

const PASSWORD = "hunter2-very-secret-pw";
const USER = "deploy-robot";

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "registry-owner", name: "Owner", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "registry-server")).id;
});

afterAll(async () => {
  await ctx.cleanup();
});

async function imageApp(name: string, imageRef = "nginx:1.27") {
  return createProject(userId, { serverId, name, deploymentMode: "image", imageRef, repoUrl: "", port: nextPort++ });
}

/** Everything a client can see from the API must be free of the password and of its sealed form. */
async function sealedPasswordOf(id: string) {
  const db = await getDb();
  const row = await db.select().from(schema.registryCredentials).where(eq(schema.registryCredentials.id, id)).get();
  return row!.passwordEnc;
}

describe("registry logins: validation", () => {
  it("refuses a host with a scheme, a path, or an empty value", async () => {
    for (const host of ["https://ghcr.io", "ghcr.io/owner", ""]) {
      await expect(createRegistryCredential(userId, { host, username: USER, password: PASSWORD })).rejects.toThrow();
    }
  });

  it("refuses a missing username or password", async () => {
    await expect(createRegistryCredential(userId, { host: "ghcr.io", username: "", password: PASSWORD })).rejects.toThrow(/username/);
    await expect(createRegistryCredential(userId, { host: "ghcr.io", username: USER, password: "" })).rejects.toThrow(/password/);
  });

  it("refuses a password with a line break", async () => {
    await expect(createRegistryCredential(userId, { host: "ghcr.io", username: USER, password: "a\nb" })).rejects.toThrow(/line breaks/);
  });

  it("refuses a second login for the same host", async () => {
    await createRegistryCredential(userId, { host: "registry.example.test", username: USER, password: PASSWORD });
    await expect(createRegistryCredential(userId, { host: "REGISTRY.example.test", username: USER, password: PASSWORD })).rejects.toThrow(/already have a login/);
  });
});

describe("registry logins: secrets", () => {
  it("stores the password sealed, not in clear, and opens it for a pull", async () => {
    const made = await createRegistryCredential(userId, { host: "ghcr.io", username: USER, password: PASSWORD });
    const sealed = await sealedPasswordOf(made.id);
    expect(sealed).not.toContain(PASSWORD);
    expect(sealed.length).toBeGreaterThan(PASSWORD.length);
    expect(await registryLoginFor(userId, made.id)).toEqual({ host: "ghcr.io", username: USER, password: PASSWORD });
  });

  it("never returns the password or its sealed form in the list", async () => {
    const made = await createRegistryCredential(userId, { host: "quay.example.test", username: USER, password: PASSWORD });
    const sealed = await sealedPasswordOf(made.id);
    const body = JSON.stringify(await listRegistryCredentials(userId));
    expect(body).not.toContain(PASSWORD);
    expect(body).not.toContain(sealed);
    expect(body).not.toContain("passwordEnc");
    expect(body).toContain("quay.example.test");
  });

  it("never returns the password from create or update", async () => {
    const made = await createRegistryCredential(userId, { host: "hub.example.test", username: USER, password: PASSWORD });
    expect(JSON.stringify(made)).not.toContain(PASSWORD);
    const changed = await updateRegistryCredential(userId, made.id, { password: "a-new-password-123" });
    expect(JSON.stringify(changed)).not.toContain("a-new-password-123");
    expect((await registryLoginFor(userId, made.id)).password).toBe("a-new-password-123");
  });

  it("does not let another owner see or use a login", async () => {
    const otherId = (await upsertUser({ id: "registry-other", name: "Other", email: null, slackId: null })).id;
    const made = await createRegistryCredential(userId, { host: "other.example.test", username: USER, password: PASSWORD });
    expect(await listRegistryCredentials(otherId)).toEqual([]);
    await expect(registryLoginFor(otherId, made.id)).rejects.toThrow(/not found/);
  });
});

describe("registry logins: removal", () => {
  it("refuses to remove a login an app uses, and names the app", async () => {
    const login = await createRegistryCredential(userId, { host: "private.example.test", username: USER, password: PASSWORD });
    const app = await imageApp("Private Web", "private.example.test/owner/web:1.0.0");
    await updateImageSource(userId, app.id, { imageRef: "private.example.test/owner/web:1.0.0", registryCredentialId: login.id });
    await expect(removeRegistryCredential(userId, login.id)).rejects.toThrow(/used by Private Web/);
    const listed = (await listRegistryCredentials(userId)).find((l) => l.id === login.id);
    expect(listed?.usedBy.map((u) => u.name)).toContain("Private Web");
  });

  it("removes the login once no app uses it", async () => {
    const login = await createRegistryCredential(userId, { host: "free.example.test", username: USER, password: PASSWORD });
    await removeRegistryCredential(userId, login.id);
    expect((await listRegistryCredentials(userId)).some((l) => l.id === login.id)).toBe(false);
  });
});

describe("image source", () => {
  it("refuses a login for a different host than the image", async () => {
    const login = await createRegistryCredential(userId, { host: "other-host.example.test", username: USER, password: PASSWORD });
    const app = await imageApp("Mismatch");
    await expect(updateImageSource(userId, app.id, { imageRef: "ghcr.io/owner/app:1", registryCredentialId: login.id })).rejects.toThrow(/That login is for other-host.example.test/);
  });

  it("sets a public image with no login", async () => {
    const app = await imageApp("Public Pull");
    const out = await updateImageSource(userId, app.id, { imageRef: "nginx:1.28", registryCredentialId: null, pullPolicy: "always" });
    expect(out).toEqual({ imageRef: "nginx:1.28", host: "docker.io", registryCredentialId: null });
  });

  it("refuses an image source change on a source app", async () => {
    const src = await createProject(userId, { serverId, name: "Source Only", repoUrl: "https://github.com/example/src", runtime: "node", startCommand: "node x.js", port: nextPort++ });
    await expect(updateImageSource(userId, src.id, { imageRef: "nginx:1.28" })).rejects.toThrow(/Only an image app/);
  });

  it("refuses a bad reference", async () => {
    const app = await imageApp("Bad Ref Update");
    await expect(updateImageSource(userId, app.id, { imageRef: "ghcr.io/Owner/app" })).rejects.toThrow(/lowercase/);
  });

  it("clears the image settings when the app changes away from image mode", async () => {
    const login = await createRegistryCredential(userId, { host: "switch.example.test", username: USER, password: PASSWORD });
    const app = await imageApp("Switch Away", "switch.example.test/owner/app:1");
    await updateImageSource(userId, app.id, { imageRef: "switch.example.test/owner/app:1", registryCredentialId: login.id, pullPolicy: "always" });
    const after = await updateProject(userId, app.id, { deploymentMode: "native", startCommand: "node x.js", port: nextPort++ });
    expect(after.deploymentMode).toBe("native");
    expect(after.imageRef).toBeNull();
    expect(after.pullPolicy).toBe("auto");
    expect(after.registryCredentialId).toBeNull();
    // The login is free again, so it can be removed.
    await removeRegistryCredential(userId, login.id);
  });
});

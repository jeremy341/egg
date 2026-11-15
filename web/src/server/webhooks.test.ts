import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { open } from "@/server/crypto";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import type { Lookup, SendRequest, Transport } from "@/server/webhook-net";
import { signWebhook, verifyWebhookSignature } from "@/server/webhook-sign";
import {
  createWebhook,
  deleteWebhook,
  dispatchDeploymentEvent,
  getWebhook,
  listDeliveries,
  listWebhooks,
  MAX_WEBHOOKS_PER_USER,
  pruneDeliveries,
  rotateWebhookSecret,
  sendTestWebhook,
  updateWebhook,
} from "@/server/webhooks";
import { createProject, type ProjectRow } from "@/server/projects";
import { createServer } from "@/server/servers";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let sam: string;
let kim: string;
let project: ProjectRow;
let otherProject: ProjectRow;

const PUBLIC: Lookup = async () => [{ address: "93.184.216.34", family: 4 }];
const sleeps: number[] = [];
const sleep = async (ms: number) => {
  sleeps.push(ms);
};

type Seen = { req: SendRequest; body: string };
function recorder(statuses: number[] = [200]) {
  const seen: Seen[] = [];
  const transport: Transport = async (req) => {
    seen.push({ req, body: req.body });
    return { status: statuses[Math.min(seen.length - 1, statuses.length - 1)] };
  };
  return { seen, transport };
}

const NOW = new Date("2026-01-02T03:04:05.000Z");
const deps = (transport: Transport) => ({ lookup: PUBLIC, transport, sleep, now: () => NOW });

let n = 0;
async function deployment(state: string, over: Partial<typeof schema.deployments.$inferInsert> = {}) {
  const id = `dep-${++n}`;
  await ctx.db.insert(schema.deployments).values({
    id,
    projectId: project.id,
    env: "production",
    state: state as never,
    source: "manual",
    branch: "main",
    commitSha: "abcdef1234567890",
    commitMessage: "LEAKY-COMMIT-MESSAGE",
    error: "LEAKY-ERROR-TEXT",
    port: 3100,
    releaseId: `rel-${n}`,
    createdAt: NOW,
    ...over,
  });
  return id;
}

beforeAll(async () => {
  ctx = await useFreshDb();
  sam = (await upsertUser({ id: "wh1", name: "Sam", email: null, slackId: null })).id;
  kim = (await upsertUser({ id: "wh2", name: "Kim", email: null, slackId: null })).id;
  const serverId = (await createServer(sam, "sam-r")).id;
  const mk = (name: string, port: number) =>
    createProject(sam, {
      serverId,
      name,
      port,
      repoUrl: "https://github.com/example/demo",
      runtime: "node",
      startCommand: "node server.js",
    });
  project = await mk("Hooked", 3021);
  otherProject = await mk("Elsewhere", 3022);
  await ctx.db.insert(schema.envVars).values({
    id: "env-1",
    projectId: project.id,
    key: "DATABASE_PASSWORD",
    valueEnc: "v1.sealed.stuff.here",
    target: "all",
    createdAt: NOW,
  } as never);
  await ctx.db
    .insert(schema.deploymentLogs)
    .values({ deploymentId: await deployment("ready"), at: NOW, level: "info", message: "LEAKY-LOG-LINE" });
});
afterAll(async () => {
  await ctx.cleanup();
});
beforeEach(async () => {
  sleeps.length = 0;
  await ctx.db.delete(schema.webhooks);
});

const URL_OK = "https://hooks.example.com/nest";

describe("creating and reading webhooks", () => {
  it("shows the secret once and stores it sealed", async () => {
    const { webhook, secret } = await createWebhook(sam, { url: URL_OK });
    expect(secret).toMatch(/^whsec_/);
    expect(webhook).toMatchObject({ url: URL_OK, host: "hooks.example.com", active: true, projectId: null });
    expect(webhook.events).toEqual(["deployment.started", "deployment.succeeded", "deployment.failed"]);

    const stored = await ctx.db.select().from(schema.webhooks).where(eq(schema.webhooks.id, webhook.id)).get();
    expect(stored?.secretEnc).not.toContain(secret);
    expect(open(stored!.secretEnc, `webhook:${webhook.id}`)).toBe(secret);
    // Bound to its own row: it does not open under another webhook's context.
    expect(() => open(stored!.secretEnc, "webhook:someone-else")).toThrow();

    const text = JSON.stringify([await listWebhooks(sam), await getWebhook(sam, webhook.id)]);
    expect(text).not.toContain(secret);
    expect(text).not.toMatch(/secretEnc|secret_enc|whsec_/);
  });

  it.each([
    ["http://hooks.example.com/x"],
    ["https://127.0.0.1/x"],
    ["https://[::1]/x"],
    ["https://user:pw@hooks.example.com/x"],
    ["https://hooks.example.com:8443/x"],
    ["https://hooks.example.com/x#frag"],
    ["https://localhost/x"],
  ])("refuses %s", async (url) => {
    await expect(createWebhook(sam, { url })).rejects.toThrow();
    expect(await listWebhooks(sam)).toHaveLength(0);
  });

  it("refuses a project that is not yours, unknown fields and an empty event list", async () => {
    const foreign = await createServer(kim, "kim-r");
    const theirs = await createProject(kim, {
      serverId: foreign.id,
      name: "Kims",
      port: 3031,
      repoUrl: "https://github.com/example/demo",
      runtime: "node",
      startCommand: "node server.js",
    });
    await expect(createWebhook(sam, { url: URL_OK, projectId: theirs.id })).rejects.toMatchObject({ status: 404 });
    await expect(createWebhook(sam, { url: URL_OK, secret: "mine" })).rejects.toThrow();
    await expect(createWebhook(sam, { url: URL_OK, events: [] })).rejects.toThrow();
  });

  it("caps how many one user can have", async () => {
    for (let i = 0; i < MAX_WEBHOOKS_PER_USER; i++) await createWebhook(sam, { url: `https://h${i}.example.com/` });
    await expect(createWebhook(sam, { url: URL_OK })).rejects.toMatchObject({ status: 409 });
  });

  it("keeps webhooks private to their owner", async () => {
    const { webhook } = await createWebhook(sam, { url: URL_OK });
    expect(await listWebhooks(kim)).toEqual([]);
    for (const act of [
      () => getWebhook(kim, webhook.id),
      () => updateWebhook(kim, webhook.id, { active: false }),
      () => deleteWebhook(kim, webhook.id),
      () => rotateWebhookSecret(kim, webhook.id),
      () => sendTestWebhook(kim, webhook.id, deps(recorder().transport)),
      () => listDeliveries(kim, webhook.id),
    ]) {
      await expect(act()).rejects.toMatchObject({ status: 404 });
    }
    expect((await getWebhook(sam, webhook.id)).active).toBe(true);
  });

  it("updates, and refuses an empty or unknown change", async () => {
    const { webhook } = await createWebhook(sam, { url: URL_OK });
    const next = await updateWebhook(sam, webhook.id, { url: "https://other.example.com/in", active: false, events: ["deployment.failed"] });
    expect(next).toMatchObject({ host: "other.example.com", active: false, events: ["deployment.failed"] });
    await expect(updateWebhook(sam, webhook.id, {})).rejects.toThrow();
    await expect(updateWebhook(sam, webhook.id, { url: "http://x.example.com" })).rejects.toThrow();
    await expect(updateWebhook(sam, webhook.id, { secretEnc: "x" })).rejects.toThrow();
  });

  it("writes an audit line for create, update, rotate, test and delete without the secret or full URL", async () => {
    const { webhook, secret } = await createWebhook(sam, { url: `${URL_OK}?token=s3cret` });
    await updateWebhook(sam, webhook.id, { active: false });
    const rotated = await rotateWebhookSecret(sam, webhook.id);
    await sendTestWebhook(sam, webhook.id, deps(recorder().transport));
    await deleteWebhook(sam, webhook.id);
    const rows = (await ctx.db.select().from(schema.auditLog).where(eq(schema.auditLog.target, webhook.id))).map((r) => r.action);
    expect(rows).toEqual(["webhook.create", "webhook.update", "webhook.rotate", "webhook.test", "webhook.delete"]);
    const meta = JSON.stringify((await ctx.db.select().from(schema.auditLog)).map((r) => r.meta));
    for (const forbidden of [secret, rotated.secret, "s3cret", "/nest"]) expect(meta).not.toContain(forbidden);
  });
});

describe("dispatching deployment events", () => {
  it("posts a signed, minimal payload for a successful deployment", async () => {
    const { webhook, secret } = await createWebhook(sam, { url: URL_OK });
    const id = await deployment("ready");
    const { seen, transport } = recorder();
    await dispatchDeploymentEvent(id, deps(transport));

    expect(seen).toHaveLength(1);
    const { req, body } = seen[0];
    expect(JSON.parse(body)).toEqual({
      event: "deployment.succeeded",
      project: { id: project.id, slug: project.slug },
      deployment: { id, branch: "main", commit: "abcdef1", state: "ready" },
      time: NOW.toISOString(),
    });
    // The request goes to the checked address, over https, to the stored path.
    expect(req.address).toBe("93.184.216.34");
    expect(req.url.toString()).toBe(URL_OK);
    expect(req.timeoutMs).toBe(5000);
    expect(req.maxBytes).toBe(4096);
    // The signature header is t=<unix>,v1=<hex> over "<t>.<body>" with this webhook's secret.
    const sig = req.headers["X-NestDeploy-Signature"];
    expect(sig).toBe(signWebhook(secret, body, Math.floor(NOW.getTime() / 1000)));
    expect(verifyWebhookSignature(secret, sig, body, Math.floor(NOW.getTime() / 1000))).toBe(true);
    expect(req.headers["X-NestDeploy-Event"]).toBe("deployment.succeeded");

    const [d] = await listDeliveries(sam, webhook.id);
    expect(d).toMatchObject({ event: "deployment.succeeded", status: "success", attempts: 1, lastErrorCode: null, deploymentId: id });
  });

  it("never puts env values, logs, commit messages, errors or secrets in the request", async () => {
    const { secret } = await createWebhook(sam, { url: URL_OK });
    const id = await deployment("error");
    const { seen, transport } = recorder();
    await dispatchDeploymentEvent(id, deps(transport));
    const everything = JSON.stringify(seen.map((s) => [s.body, s.req.headers, s.req.url.toString()]));
    for (const leak of ["LEAKY-COMMIT-MESSAGE", "LEAKY-ERROR-TEXT", "LEAKY-LOG-LINE", "DATABASE_PASSWORD", "v1.sealed", secret]) {
      expect(everything).not.toContain(leak);
    }
    expect(JSON.parse(seen[0].body)).toMatchObject({ event: "deployment.failed", deployment: { state: "error" } });
  });

  it("maps building to started and ignores states that have no event", async () => {
    await createWebhook(sam, { url: URL_OK });
    const { seen, transport } = recorder();
    await dispatchDeploymentEvent(await deployment("building"), deps(transport));
    expect(JSON.parse(seen[0].body).event).toBe("deployment.started");
    for (const state of ["queued", "deploying", "canceled"]) {
      await dispatchDeploymentEvent(await deployment(state), deps(transport));
    }
    expect(seen).toHaveLength(1);
  });

  it("reports the state that changed, even if the deployment has moved on since", async () => {
    await createWebhook(sam, { url: URL_OK });
    const { seen, transport } = recorder();
    const id = await deployment("ready");
    await dispatchDeploymentEvent(id, { ...deps(transport), state: "building" });
    expect(JSON.parse(seen[0].body)).toMatchObject({ event: "deployment.started", deployment: { state: "building" } });
  });

  it("only sends to active webhooks that want the event and cover the project", async () => {
    await createWebhook(sam, { url: "https://all.example.com/", events: ["deployment.succeeded"] });
    await createWebhook(sam, { url: "https://failed-only.example.com/", events: ["deployment.failed"] });
    await createWebhook(sam, { url: "https://other-project.example.com/", projectId: otherProject.id });
    const off = await createWebhook(sam, { url: "https://off.example.com/" });
    await updateWebhook(sam, off.webhook.id, { active: false });
    await createWebhook(sam, { url: "https://mine-only.example.com/", projectId: project.id });
    await createWebhook(kim, { url: "https://kims.example.com/" });

    const { seen, transport } = recorder();
    await dispatchDeploymentEvent(await deployment("ready"), deps(transport));
    expect(seen.map((s) => s.req.url.hostname).sort()).toEqual(["all.example.com", "mine-only.example.com"]);
  });

  it("retries a failing receiver up to 3 times with a growing pause, then records the code", async () => {
    const { webhook } = await createWebhook(sam, { url: URL_OK });
    const { seen, transport } = recorder([500]);
    await dispatchDeploymentEvent(await deployment("ready"), deps(transport));
    expect(seen).toHaveLength(3);
    expect(sleeps).toEqual([2000, 10000]);
    const [d] = await listDeliveries(sam, webhook.id);
    expect(d).toMatchObject({ status: "failed", attempts: 3, lastErrorCode: "http_500" });
    expect(d.finishedAt).not.toBeNull();
  });

  it("stops retrying once an attempt works", async () => {
    const { webhook } = await createWebhook(sam, { url: URL_OK });
    const { seen, transport } = recorder([503, 200]);
    await dispatchDeploymentEvent(await deployment("ready"), deps(transport));
    expect(seen).toHaveLength(2);
    expect((await listDeliveries(sam, webhook.id))[0]).toMatchObject({ status: "success", attempts: 2, lastErrorCode: null });
  });

  it("does not retry an answer that will not change (404)", async () => {
    const { webhook } = await createWebhook(sam, { url: URL_OK });
    const { seen, transport } = recorder([404]);
    await dispatchDeploymentEvent(await deployment("ready"), deps(transport));
    expect(seen).toHaveLength(1);
    expect((await listDeliveries(sam, webhook.id))[0]).toMatchObject({ status: "failed", attempts: 1, lastErrorCode: "http_404" });
  });

  it("does not follow a redirect and records it", async () => {
    const { webhook } = await createWebhook(sam, { url: URL_OK });
    const { seen, transport } = recorder([302]);
    await dispatchDeploymentEvent(await deployment("ready"), deps(transport));
    expect(seen).toHaveLength(1);
    expect((await listDeliveries(sam, webhook.id))[0]).toMatchObject({ status: "failed", lastErrorCode: "redirect" });
  });

  it("refuses a name that resolves to an internal address and never connects", async () => {
    const { webhook } = await createWebhook(sam, { url: URL_OK });
    const { seen, transport } = recorder();
    for (const address of ["10.0.0.5", "169.254.169.254", "127.0.0.1", "100.64.0.1", "fd00::1", "::ffff:192.168.1.1"]) {
      const lookup: Lookup = async () => [{ address, family: address.includes(":") ? 6 : 4 }];
      await dispatchDeploymentEvent(await deployment("ready"), { ...deps(transport), lookup });
    }
    expect(seen).toHaveLength(0);
    const all = await listDeliveries(sam, webhook.id);
    expect(all).toHaveLength(6);
    expect(all.every((d) => d.status === "failed" && d.lastErrorCode === "blocked_address" && d.attempts === 1)).toBe(true);
  });

  it("never throws into the caller, whatever goes wrong", async () => {
    await createWebhook(sam, { url: URL_OK });
    const boom: Transport = async () => {
      throw new Error("kaboom with a secret");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(dispatchDeploymentEvent(await deployment("ready"), deps(boom))).resolves.toBeUndefined();
    await expect(dispatchDeploymentEvent("no-such-deployment", deps(boom))).resolves.toBeUndefined();
    const brokenLookup: Lookup = async () => {
      throw new Error("dns down");
    };
    await expect(
      dispatchDeploymentEvent(await deployment("ready"), { ...deps(recorder().transport), lookup: brokenLookup })
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it("does not leak a thrown message into the delivery record", async () => {
    const { webhook } = await createWebhook(sam, { url: URL_OK });
    const boom: Transport = async () => {
      throw new Error("kaboom with a secret");
    };
    await dispatchDeploymentEvent(await deployment("ready"), deps(boom));
    const [d] = await listDeliveries(sam, webhook.id);
    expect(d.lastErrorCode).toBe("internal");
    expect(JSON.stringify(d)).not.toContain("kaboom");
  });

  it("stops everything if the database is gone, instead of throwing", async () => {
    // A deployment that points at a missing project.
    const id = await deployment("ready", { projectId: project.id });
    await ctx.db.run(sql`PRAGMA foreign_keys = OFF`);
    await ctx.db.update(schema.deployments).set({ projectId: "ghost" }).where(eq(schema.deployments.id, id));
    await ctx.db.run(sql`PRAGMA foreign_keys = ON`);
    await expect(dispatchDeploymentEvent(id, deps(recorder().transport))).resolves.toBeUndefined();
  });
});

describe("test send", () => {
  it("sends one signed, plainly fake message with a single attempt", async () => {
    const { webhook, secret } = await createWebhook(sam, { url: URL_OK });
    const { seen, transport } = recorder([500]);
    const result = await sendTestWebhook(sam, webhook.id, deps(transport));
    expect(seen).toHaveLength(1);
    expect(result).toMatchObject({ status: "failed", attempts: 1, lastErrorCode: "http_500", event: "webhook.test" });
    const body = JSON.parse(seen[0].body);
    expect(body).toMatchObject({ event: "webhook.test", test: true, project: { id: "test-project" } });
    expect(verifyWebhookSignature(secret, seen[0].req.headers["X-NestDeploy-Signature"], seen[0].body, Math.floor(NOW.getTime() / 1000))).toBe(true);
    expect(await listDeliveries(sam, webhook.id)).toHaveLength(1);
  });
});

describe("rotating the secret", () => {
  it("signs with the new secret straight away and the old one stops matching", async () => {
    const created = await createWebhook(sam, { url: URL_OK });
    const rotated = await rotateWebhookSecret(sam, created.webhook.id);
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.webhook.secretRotatedAt).not.toBeNull();
    const { seen, transport } = recorder();
    await dispatchDeploymentEvent(await deployment("ready"), deps(transport));
    const t = Math.floor(NOW.getTime() / 1000);
    const sig = seen[0].req.headers["X-NestDeploy-Signature"];
    expect(verifyWebhookSignature(rotated.secret, sig, seen[0].body, t)).toBe(true);
    expect(verifyWebhookSignature(created.secret, sig, seen[0].body, t)).toBe(false);
  });
});

describe("delivery history", () => {
  it("removes deliveries after 30 days and closes ones that were cut off", async () => {
    const { webhook } = await createWebhook(sam, { url: URL_OK });
    const day = 86_400_000;
    const now = new Date("2026-03-01T00:00:00Z");
    const row = (id: string, ageMs: number, status: "pending" | "success") => ({
      id,
      webhookId: webhook.id,
      event: "deployment.succeeded",
      status,
      attempts: 1,
      createdAt: new Date(now.getTime() - ageMs),
    });
    await ctx.db.insert(schema.webhookDeliveries).values([
      row("old", 31 * day, "success"),
      row("recent", 29 * day, "success"),
      row("stuck", 60 * 60_000, "pending"),
      row("busy", 60_000, "pending"),
    ]);
    await pruneDeliveries(now);
    const left = Object.fromEntries((await ctx.db.select().from(schema.webhookDeliveries)).map((d) => [d.id, d]));
    expect(Object.keys(left).sort()).toEqual(["busy", "recent", "stuck"]);
    expect(left.stuck).toMatchObject({ status: "failed", lastErrorCode: "interrupted" });
    expect(left.busy.status).toBe("pending");
  });

  it("goes away with the webhook", async () => {
    const { webhook } = await createWebhook(sam, { url: URL_OK });
    await dispatchDeploymentEvent(await deployment("ready"), deps(recorder().transport));
    expect(await ctx.db.select().from(schema.webhookDeliveries)).toHaveLength(1);
    await deleteWebhook(sam, webhook.id);
    expect(await ctx.db.select().from(schema.webhookDeliveries)).toHaveLength(0);
  });
});

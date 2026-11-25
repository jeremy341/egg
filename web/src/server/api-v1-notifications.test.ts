import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal, Scope } from "@/server/api-tokens";
import { callEndpoint } from "@/server/api-v1";
import { NOTIFICATION_ENDPOINTS } from "@/server/api-v1-notifications";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

// A test send must never leave the machine. The delivery row is still written
// by the real service, so the list and replay tests exercise the real log.
vi.mock("@/server/webhook-net", async (original) => ({
  ...(await original<typeof import("@/server/webhook-net")>()),
  safePost: vi.fn(async () => ({ status: 200 })),
}));

const OWNER_PROFILE = "notif-api-owner";
const OUTSIDER_PROFILE = "notif-api-outsider";
const URL = "https://hooks.example.com/inbox";
const OTHER_URL = "https://hooks.example.com/other";
const deploymentId = "99999999-9999-4999-8999-999999999999";

type Channel = {
  id: string;
  url: string;
  host: string;
  projectId: string | null;
  events: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  secretRotatedAt: string | null;
};
type Delivery = {
  id: string;
  webhookId: string;
  event: string;
  deploymentId: string | null;
  status: "pending" | "success" | "failed";
  attempts: number;
  lastErrorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
};
type Rule = { id: string; webhookId: string; projectId: string | null; events: string[] };

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let ownerId: string;
let outsiderId: string;
let projectId: string;

const principal = (userId: string, scopes: Scope[]): Principal => ({ userId, tokenId: "test-token", scopes });
const reader = () => principal(ownerId, ["webhooks:read"]);
const writer = () => principal(ownerId, ["webhooks:read", "webhooks:write"]);
const endpoint = (id: string) => {
  const found = NOTIFICATION_ENDPOINTS.find((entry) => entry.id === id);
  expect(found, `endpoint ${id} exists`).toBeDefined();
  if (!found) throw new Error(`Missing endpoint ${id}`);
  return found;
};
const call = (id: string, p: Principal, raw: unknown = {}) => callEndpoint(p, endpoint(id), raw);
const create = async (url = URL) => {
  const made = (await call("create_notification_channel", writer(), { url })) as {
    channel: Channel;
    webhook: Channel;
    secret: string;
  };
  return made;
};

beforeAll(async () => {
  ctx = await useFreshDb();
  ownerId = (await upsertUser({ id: OWNER_PROFILE, name: "Owner", email: null, slackId: null })).id;
  outsiderId = (await upsertUser({ id: OUTSIDER_PROFILE, name: "Outsider", email: null, slackId: null })).id;
  const serverId = (await createServer(ownerId, "notif-api-server")).id;
  projectId = (
    await createProject(ownerId, {
      serverId,
      name: "Notify API App",
      slug: "notify-api-app",
      repoUrl: "https://github.com/sam/notify-api.git",
      runtime: "node",
      port: 3901,
    })
  ).id;
  const now = new Date("2026-01-02T03:04:05.000Z");
  await ctx.db.insert(schema.deployments).values({
    id: deploymentId,
    projectId,
    env: "production",
    state: "error",
    source: "manual",
    branch: "main",
    commitSha: "abcdef1234567890",
    commitMessage: "A failure to replay",
    error: "build failed",
    port: 3100,
    releaseId: "rel-notif-replay",
    createdAt: now,
  });
});

afterAll(async () => {
  await ctx.cleanup();
});

beforeEach(async () => {
  await ctx.db.delete(schema.webhookDeliveries);
  await ctx.db.delete(schema.webhooks);
});

describe("the notification endpoint list", () => {
  it("has the Orchard notification operations exactly once", () => {
    expect(NOTIFICATION_ENDPOINTS.map((ep) => ep.id)).toEqual([
      "list_notification_channels",
      "create_notification_channel",
      "get_notification_channel",
      "update_notification_channel",
      "delete_notification_channel",
      "list_notification_rules",
      "create_notification_rule",
      "update_notification_rule",
      "delete_notification_rule",
      "list_notification_deliveries",
      "replay_notification_channel",
      "test_notification_channel",
    ]);
    expect(new Set(NOTIFICATION_ENDPOINTS.map((ep) => ep.id)).size).toBe(NOTIFICATION_ENDPOINTS.length);
    expect(new Set(NOTIFICATION_ENDPOINTS.map((ep) => `${ep.method} ${ep.path}`)).size).toBe(
      NOTIFICATION_ENDPOINTS.length
    );
  });

  it("describes each route with the right scope, tag and behaviour", () => {
    expect(endpoint("list_notification_channels")).toMatchObject({
      method: "GET",
      path: "/notification-channels",
      scope: "webhooks:read",
      bucket: "read",
      readOnly: true,
      tag: "Notifications",
    });
    expect(endpoint("create_notification_channel")).toMatchObject({
      method: "POST",
      scope: "webhooks:write",
      status: 201,
      sensitive: true,
    });
    expect(endpoint("get_notification_channel")).toMatchObject({
      method: "GET",
      path: "/notification-channels/{channelId}",
      scope: "webhooks:read",
      readOnly: true,
    });
    expect(endpoint("update_notification_channel")).toMatchObject({ method: "PATCH", scope: "webhooks:write" });
    expect(endpoint("delete_notification_channel")).toMatchObject({
      method: "DELETE",
      scope: "webhooks:write",
      destructive: true,
    });
    expect(endpoint("list_notification_rules")).toMatchObject({
      method: "GET",
      path: "/notification-rules",
      scope: "webhooks:read",
      readOnly: true,
    });
    expect(endpoint("create_notification_rule")).toMatchObject({
      method: "POST",
      path: "/notification-channels/{channelId}/rules",
      scope: "webhooks:write",
    });
    expect(endpoint("update_notification_rule")).toMatchObject({ method: "PATCH", scope: "webhooks:write" });
    expect(endpoint("delete_notification_rule")).toMatchObject({ method: "DELETE", destructive: true });
    expect(endpoint("list_notification_deliveries")).toMatchObject({
      method: "GET",
      path: "/notification-channels/{channelId}/deliveries",
      scope: "webhooks:read",
      readOnly: true,
    });
    expect(Object.keys(endpoint("list_notification_deliveries").query)).toEqual(["limit"]);
    expect(endpoint("replay_notification_channel")).toMatchObject({
      method: "POST",
      path: "/notification-channels/{channelId}/deliveries/{deliveryId}/replay",
      scope: "webhooks:write",
      bucket: "ssh",
    });
    expect(endpoint("test_notification_channel")).toMatchObject({
      method: "POST",
      path: "/notification-channels/{channelId}/test",
      scope: "webhooks:write",
      bucket: "ssh",
    });
    expect(NOTIFICATION_ENDPOINTS.every((ep) => ep.scope === "webhooks:read" || ep.scope === "webhooks:write")).toBe(
      true
    );
  });

  it("validates inputs before touching the service", async () => {
    const cases: [string, unknown][] = [
      ["create_notification_channel", { url: "http://hooks.example.com/in" }],
      ["create_notification_channel", { url: URL, events: [] }],
      ["create_notification_channel", { url: URL, stray: true }],
      ["get_notification_channel", { channelId: "  " }],
      ["update_notification_channel", { channelId: "c", active: "yes" }],
      ["delete_notification_channel", { channelId: "c" }],
      ["delete_notification_channel", { channelId: "c", extra: 1 }],
      ["create_notification_rule", { channelId: "c", events: ["not.an.event"] }],
      ["update_notification_rule", { channelId: "c", ruleId: "r", events: [] }],
      ["delete_notification_rule", { channelId: "c", ruleId: "" }],
      ["list_notification_deliveries", { channelId: "c", limit: 1000 }],
      ["replay_notification_channel", { channelId: "c", deliveryId: "" }],
      ["test_notification_channel", { channelId: "c", extra: true }],
    ];
    for (const [id, raw] of cases) {
      expect(() => endpoint(id).input.parse(raw), id).toThrow();
    }
    expect(await ctx.db.select().from(schema.webhooks)).toHaveLength(0);
  });

  it("needs the webhook scope for every endpoint", async () => {
    const { channel } = await create();
    for (const ep of NOTIFICATION_ENDPOINTS) {
      await expect(call(ep.id, principal(ownerId, []), { channelId: channel.id }), ep.id).rejects.toMatchObject({
        status: 403,
      });
    }
  });
});

describe("channel CRUD", () => {
  it("creates, lists, reads, updates and deletes a channel, showing the secret only once", async () => {
    const { channel, webhook, secret } = await create();
    expect(secret).toMatch(/^whsec_/);
    expect(channel).toMatchObject({ id: channel.id, host: "hooks.example.com", active: true, projectId: null });
    expect(webhook.id).toBe(channel.id);

    const listed = (await call("list_notification_channels", reader())) as { channels: Channel[]; webhooks: Channel[] };
    expect(listed.channels.map((c) => c.id)).toEqual([channel.id]);
    expect(listed.webhooks.map((c) => c.id)).toEqual([channel.id]);
    expect(JSON.stringify(listed)).not.toContain(secret);

    const one = (await call("get_notification_channel", reader(), { channelId: channel.id })) as { channel: Channel };
    expect(one.channel.id).toBe(channel.id);
    expect(JSON.stringify(one)).not.toContain(secret);

    const updated = (await call("update_notification_channel", writer(), {
      channelId: channel.id,
      events: ["deployment.failed"],
      active: false,
    })) as { channel: Channel };
    expect(updated.channel.events).toEqual(["deployment.failed"]);
    expect(updated.channel.active).toBe(false);

    await expect(
      call("delete_notification_channel", writer(), { channelId: channel.id, confirmChannelId: "different-channel" })
    ).rejects.toMatchObject({ status: 400, code: "confirmation_failed" });

    const deleted = (await call("delete_notification_channel", writer(), {
      channelId: channel.id,
      confirmChannelId: channel.id,
    })) as {
      deleted: boolean;
      channelId: string;
    };
    expect(deleted).toEqual({ deleted: true, channelId: channel.id });
    const deleteAudit = (await ctx.db.select().from(schema.auditLog)).find((row) => {
      if (row.userId !== ownerId || row.action !== "webhook.delete" || !row.meta) return false;
      try {
        return JSON.parse(row.meta).channelId === channel.id;
      } catch {
        return false;
      }
    });
    expect(deleteAudit?.meta).toContain('"via":"api"');
    expect(deleteAudit?.meta).toContain('"token":"test-token"');
    expect((await call("list_notification_channels", reader())) as { channels: Channel[] }).toMatchObject({
      channels: [],
    });
  });

  it("keeps another owner's channel private", async () => {
    const { channel } = await create();
    const outsider = () => principal(outsiderId, ["webhooks:read", "webhooks:write"]);
    await expect(call("get_notification_channel", outsider(), { channelId: channel.id })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      call("update_notification_channel", outsider(), { channelId: channel.id, active: false })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      call("delete_notification_channel", outsider(), { channelId: channel.id, confirmChannelId: channel.id })
    ).rejects.toMatchObject({ status: 404 });
    await expect(call("list_notification_deliveries", outsider(), { channelId: channel.id })).rejects.toMatchObject({
      status: 404,
    });
    await expect(call("test_notification_channel", outsider(), { channelId: channel.id })).rejects.toMatchObject({
      status: 404,
    });
    const rows = await ctx.db.select().from(schema.webhooks);
    expect(rows.filter((row) => row.id === channel.id)).toHaveLength(1);
  });

  it("scopes a channel to one of the owner's projects and refuses someone else's", async () => {
    const scoped = (await call("create_notification_channel", writer(), { url: URL, projectId })) as {
      channel: Channel;
    };
    expect(scoped.channel.projectId).toBe(projectId);
    await expect(
      call("create_notification_channel", writer(), { url: OTHER_URL, projectId: "someone-elses" })
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("rule CRUD", () => {
  it("lists one rule per channel and merges, replaces and resets its events", async () => {
    const { channel } = await create();
    const listed = (await call("list_notification_rules", reader())) as { rules: Rule[] };
    expect(listed.rules).toHaveLength(1);
    expect(listed.rules[0]).toMatchObject({
      id: channel.id,
      webhookId: channel.id,
      projectId: null,
      events: ["deployment.started", "deployment.succeeded", "deployment.failed", "deploy.regressed"],
    });

    const added = (await call("create_notification_rule", writer(), {
      channelId: channel.id,
      events: ["deployment.failed"],
    })) as { rule: Rule };
    expect(added.rule.events).toHaveLength(4);
    expect(added.rule.events.filter((e) => e === "deployment.failed")).toHaveLength(1);

    const replaced = (await call("update_notification_rule", writer(), {
      channelId: channel.id,
      ruleId: channel.id,
      events: ["deployment.succeeded"],
    })) as { rule: Rule };
    expect(replaced.rule.events).toEqual(["deployment.succeeded"]);

    const reset = (await call("delete_notification_rule", writer(), {
      channelId: channel.id,
      ruleId: channel.id,
    })) as { deleted: boolean; rule: Rule };
    expect(reset.deleted).toBe(true);
    expect(reset.rule.events).toHaveLength(4);

    await expect(
      call("update_notification_rule", writer(), { channelId: channel.id, ruleId: "wrong", events: ["deployment.failed"] })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      call("delete_notification_rule", writer(), { channelId: channel.id, ruleId: "wrong" })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("deliveries, test and replay", () => {
  it("records a test send and lists it without the signing secret", async () => {
    const { channel, secret } = await create();
    const tested = (await call("test_notification_channel", writer(), { channelId: channel.id })) as {
      delivery: Delivery;
    };
    expect(tested.delivery).toMatchObject({
      webhookId: channel.id,
      event: "webhook.test",
      deploymentId: null,
      status: "success",
      attempts: 1,
      lastErrorCode: null,
    });

    const listed = (await call("list_notification_deliveries", reader(), {
      channelId: channel.id,
      limit: 5,
    })) as { deliveries: Delivery[] };
    expect(listed.deliveries.map((d) => d.id)).toEqual([tested.delivery.id]);
    expect(JSON.stringify(listed)).not.toContain(secret);
  });

  it("replays a recorded test delivery as a fresh signed sample", async () => {
    const { channel } = await create();
    const first = (await call("test_notification_channel", writer(), { channelId: channel.id })) as {
      delivery: Delivery;
    };
    const replayed = (await call("replay_notification_channel", writer(), {
      channelId: channel.id,
      deliveryId: first.delivery.id,
    })) as { replayed: boolean; deliveryId: string; delivery: Delivery; note: string };

    expect(replayed.replayed).toBe(true);
    expect(replayed.deliveryId).toBe(first.delivery.id);
    expect(replayed.delivery.id).not.toBe(first.delivery.id);
    expect(replayed.delivery.event).toBe("webhook.test");
    expect(replayed.note).toContain("fresh signed sample");

    const listed = (await call("list_notification_deliveries", reader(), { channelId: channel.id })) as {
      deliveries: Delivery[];
    };
    expect(listed.deliveries.map((d) => d.id)).toContain(replayed.delivery.id);
  });

  it("replays a recorded deployment event from the delivery log", async () => {
    const { channel } = await create();
    const at = new Date("2026-01-02T03:04:06.000Z");
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await ctx.db.insert(schema.webhookDeliveries).values({
      id,
      webhookId: channel.id,
      event: "deployment.failed",
      deploymentId,
      status: "failed",
      attempts: 3,
      lastErrorCode: "http_500",
      createdAt: at,
    });

    const replayed = (await call("replay_notification_channel", writer(), {
      channelId: channel.id,
      deliveryId: id,
    })) as { replayed: boolean; event: string; deploymentId: string; delivery: Delivery | null };

    expect(replayed).toMatchObject({ replayed: true, event: "deployment.failed", deploymentId });
    expect(replayed.delivery).not.toBeNull();
    expect(replayed.delivery?.event).toBe("deployment.failed");
    expect(replayed.delivery?.status).toBe("success");
  });

  it("refuses an unknown delivery and keeps replays private to their owner", async () => {
    const { channel } = await create();
    await expect(
      call("replay_notification_channel", writer(), { channelId: channel.id, deliveryId: "missing" })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      call("replay_notification_channel", principal(outsiderId, ["webhooks:write"]), {
        channelId: channel.id,
        deliveryId: "missing",
      })
    ).rejects.toMatchObject({ status: 404 });
  });
});

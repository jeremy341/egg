import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/server/api-tokens";
import { callEndpoint, ENDPOINTS } from "@/server/api-v1";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createWebhook, getWebhook } from "@/server/webhooks";
import { useFreshDb } from "@/server/test/db";

const OWNER_PROFILE = "dangerous-api-owner";
const CHANNEL_URL = "https://hooks.example.com/inbox";
const TOKEN_ID = "dangerous-api-token";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let ownerId: string;

const writer = (): Principal => ({ userId: ownerId, tokenId: TOKEN_ID, scopes: ["webhooks:write"] });
const deleteNotificationChannel = () => {
  const endpoint = ENDPOINTS.find(({ id }) => id === "delete_notification_channel");
  expect(endpoint, "delete_notification_channel is registered").toBeDefined();
  if (!endpoint) throw new Error("Missing delete_notification_channel endpoint");
  return endpoint;
};

beforeAll(async () => {
  ctx = await useFreshDb();
  ownerId = (await upsertUser({ id: OWNER_PROFILE, name: "Owner", email: null, slackId: null })).id;
});

afterAll(async () => {
  await ctx.cleanup();
});

beforeEach(async () => {
  await ctx.db.delete(schema.webhookDeliveries);
  await ctx.db.delete(schema.webhooks);
  await ctx.db.delete(schema.auditLog);
});

describe("dangerous API endpoint safeguards", () => {
  it("requires exact channel-host confirmation before deleting and tags the audit", async () => {
    const channel = (await createWebhook(ownerId, { url: CHANNEL_URL, events: ["deployment.succeeded"] })).webhook;
    const endpoint = deleteNotificationChannel();

    await expect(
      callEndpoint(writer(), endpoint, { channelId: channel.id, confirmName: "wrong.example.com" })
    ).rejects.toMatchObject({ status: 400, code: "confirmation_failed" });
    await expect(getWebhook(ownerId, channel.id)).resolves.toMatchObject({ id: channel.id });
    expect(
      await ctx.db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.action, "webhook.delete"), eq(schema.auditLog.target, channel.id)))
    ).toHaveLength(0);

    await expect(
      callEndpoint(writer(), endpoint, { channelId: channel.id, confirmName: "hooks.example.com" })
    ).resolves.toEqual({ deleted: true, channelId: channel.id });
    const deletion = await ctx.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, "webhook.delete"), eq(schema.auditLog.target, channel.id)));
    expect(deletion).toHaveLength(1);
    expect(JSON.parse(deletion[0].meta ?? "{}")).toMatchObject({
      host: "hooks.example.com",
      via: "api",
      token: TOKEN_ID,
    });
    await expect(getWebhook(ownerId, channel.id)).rejects.toMatchObject({ status: 404 });
  });
});

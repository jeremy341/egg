import { readObjectBody, webhookRoute } from "@/server/webhooks-http";
import { createWebhook, listWebhooks } from "@/server/webhooks";

/** Your webhooks. Never includes a secret. */
export const GET = webhookRoute("webhooks:read", "read", async (p) => ({
  data: { webhooks: await listWebhooks(p.userId) },
}));

/** Create a webhook. The response carries the signing secret once. */
export const POST = webhookRoute("webhooks:write", "write", async (p, req) => ({
  data: await createWebhook(p.userId, await readObjectBody(req)),
  status: 201,
}));

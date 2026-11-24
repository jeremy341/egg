import { notFound } from "@/server/http";
import { rotateWebhookSecret } from "@/server/webhooks";
import { webhookRoute } from "@/server/webhooks-http";

/** Replace the signing secret. The old one stops working at once; the new one is shown once. */
export const POST = webhookRoute("webhooks:write", "write", async (p, _req, id) => {
  if (!id) throw notFound("Webhook not found");
  return { data: await rotateWebhookSecret(p.userId, id) };
}, true);

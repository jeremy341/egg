import { notFound } from "@/server/http";
import { sendTestWebhook } from "@/server/webhooks";
import { webhookRoute } from "@/server/webhooks-http";

/** Send one signed sample event and return the recorded delivery. */
export const POST = webhookRoute("webhooks:write", "ssh", async (p, _req, id) => {
  if (!id) throw notFound("Webhook not found");
  return { data: { delivery: await sendTestWebhook(p.userId, id) } };
}, true);

import { readObjectBody, webhookRoute } from "@/server/webhooks-http";
import { deleteWebhook, getWebhook, listDeliveries, updateWebhook } from "@/server/webhooks";
import { notFound } from "@/server/http";

const need = (id: string | undefined) => {
  if (!id) throw notFound("Webhook not found");
  return id;
};

/** One webhook and its recent deliveries (id, event, status, attempts, last error code). */
export const GET = webhookRoute("webhooks:read", "read", async (p, _req, id) => ({
  data: { webhook: await getWebhook(p.userId, need(id)), deliveries: await listDeliveries(p.userId, need(id)) },
}));

/** Change the URL, the events or whether it is active. */
export const PATCH = webhookRoute("webhooks:write", "write", async (p, req, id) => ({
  data: { webhook: await updateWebhook(p.userId, need(id), await readObjectBody(req)) },
}));

export const DELETE = webhookRoute("webhooks:write", "write", async (p, _req, id) => {
  await deleteWebhook(p.userId, need(id));
  return { data: { ok: true } };
});

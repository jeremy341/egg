import { NextResponse } from "next/server";
import { authed, handle } from "@/server/http";
import { createWebhook, listDeliveries, listWebhooks } from "@/server/webhooks";
import { enforceSessionRate, readObjectBody } from "@/server/webhooks-http";

/** Secrets can be in these responses: never cache. */
const NO_STORE = { "Cache-Control": "no-store" };

/** The signed-in user's webhooks, each with its few most recent deliveries. Never a secret. */
export const GET = handle(async () => {
  const user = await authed();
  const hooks = await listWebhooks(user.id);
  const webhooks = await Promise.all(
    hooks.map(async (w) => ({ ...w, deliveries: await listDeliveries(user.id, w.id, 5) }))
  );
  return NextResponse.json({ webhooks }, { headers: NO_STORE });
});

/** Create a webhook. The signing secret is in the response once. */
export const POST = handle(async (req) => {
  const user = await authed();
  enforceSessionRate(user.id, "write");
  const result = await createWebhook(user.id, await readObjectBody(req));
  return NextResponse.json(result, { status: 201, headers: NO_STORE });
});

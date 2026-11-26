import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, handle, zodToHttp } from "@/server/http";
import { deleteWebhook, rotateWebhookSecret, sendTestWebhook, updateWebhook } from "@/server/webhooks";
import { enforceSessionRate, readObjectBody } from "@/server/webhooks-http";

const NO_STORE = { "Cache-Control": "no-store" };
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle<Ctx>(async (req, ctx) => {
  const user = await authed();
  enforceSessionRate(user.id, "write");
  const webhook = await updateWebhook(user.id, (await ctx.params).id, await readObjectBody(req));
  return NextResponse.json({ webhook }, { headers: NO_STORE });
});

export const DELETE = handle<Ctx>(async (_req, ctx) => {
  const user = await authed();
  enforceSessionRate(user.id, "write");
  await deleteWebhook(user.id, (await ctx.params).id);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
});

const action = z.object({ action: z.enum(["rotate", "test"]) }).strict();

/** `{ "action": "rotate" }` replaces the secret (shown once); `{ "action": "test" }` sends a sample message. */
export const POST = handle<Ctx>(async (req, ctx) => {
  const user = await authed();
  const parsed = action.safeParse(await readObjectBody(req));
  if (!parsed.success) throw zodToHttp(parsed.error);
  const id = (await ctx.params).id;
  if (parsed.data.action === "test") {
    enforceSessionRate(user.id, "test");
    return NextResponse.json({ delivery: await sendTestWebhook(user.id, id) }, { headers: NO_STORE });
  }
  enforceSessionRate(user.id, "write");
  return NextResponse.json(await rotateWebhookSecret(user.id, id), { headers: NO_STORE });
});

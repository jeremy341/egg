import { authed, handle, ok } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { sendTestNotification } from "@/server/notify";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  // Posting a test webhook is externally visible and expensive, so it gets its own tight bucket.
  enforceRateLimit("notifyTest", user.id);
  enforceRateLimit("sshSession", user.id);
  const { id } = await params;
  await sendTestNotification(user.id, id);
  return ok({ ok: true });
});

import { authed, handle, ok } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { restartService } from "@/server/runtime-info";
import { forgetServiceStatus } from "@/server/service-status";

type Ctx = { params: Promise<{ id: string }> };

/** Restart the production service on the user's container. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  enforceRateLimit("sshSession", user.id);
  const { id } = await params;
  await restartService(user.id, id);
  forgetServiceStatus(id);
  return ok({ ok: true });
});

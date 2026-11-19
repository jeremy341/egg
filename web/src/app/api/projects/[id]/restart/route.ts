import { authed, handle, ok } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { restartService } from "@/server/runtime-info";
import { forgetServiceStatus } from "@/server/service-status";

type Ctx = { params: Promise<{ id: string }> };

/** Restart the production service on the user's container. Each restart opens an SSH connection, so it is limited. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  enforceRateLimit("serviceRestart", user.id);
  await restartService(user.id, id);
  forgetServiceStatus(id);
  return ok({ ok: true });
});

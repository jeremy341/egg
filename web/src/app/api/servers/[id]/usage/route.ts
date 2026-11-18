import { authed, handle, ok } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { fetchUsage } from "@/server/runtime-info";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  enforceRateLimit("sshSession", user.id);
  const { id } = await params;
  return ok({ usage: await fetchUsage(user.id, id) });
});

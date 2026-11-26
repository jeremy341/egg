import { authed, handle, ok } from "@/server/http";
import { fetchUsage } from "@/server/runtime-info";
import { enforceRateLimit } from "@/server/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

/** CPU, memory and disk, measured now over SSH. Each read opens a connection, so it is limited per user. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  enforceRateLimit("sshCall", user.id);
  return ok({ usage: await fetchUsage(user.id, id) });
});

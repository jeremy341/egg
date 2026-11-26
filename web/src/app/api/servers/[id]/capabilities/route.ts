import { authed, handle, ok } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { getServerForUser, withServerSession } from "@/server/servers";
import { probeTargetCapabilities } from "@/server/capabilities";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  // The capability probe runs a script over SSH, so it spends from the slow-call bucket.
  enforceRateLimit("sshCall", user.id);
  const { id } = await params;
  const server = await getServerForUser(user.id, id);
  return ok(await withServerSession(server, probeTargetCapabilities));
});

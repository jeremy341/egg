import { authed, handle, ok } from "@/server/http";
import { getServerForUser, withServerSession } from "@/server/servers";
import { probeTargetCapabilities } from "@/server/capabilities";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const server = await getServerForUser(user.id, id);
  return ok(await withServerSession(server, probeTargetCapabilities));
});

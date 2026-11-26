import { authed, handle, ok } from "@/server/http";
import { readJsonLimited } from "@/server/body-limit";
import { recoverBuild } from "@/server/operator-recovery";
type Ctx = { params: Promise<{ serverId: string }> };
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { serverId } = await params;
  await recoverBuild(user.id, serverId, await readJsonLimited(req));
  return ok({ recovered: true });
});

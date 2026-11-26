import { authed, handle, ok } from "@/server/http";
import { listAdminWorkspaces } from "@/server/grafts/greenhouse";
import { requireGraftAdmin, requireGraftEnabled } from "@/server/grafts/registry";

export const GET = handle(async () => {
  const user = await authed();
  await requireGraftAdmin(user.id);
  await requireGraftEnabled("greenhouse");
  return ok({ workspaces: await listAdminWorkspaces() });
});

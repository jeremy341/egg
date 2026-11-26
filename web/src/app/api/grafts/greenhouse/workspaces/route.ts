import { authed, handle, ok, readJson } from "@/server/http";
import { createWorkspace, createWorkspaceInput, listUserWorkspaces } from "@/server/grafts/greenhouse";
import { requireGraftEnabled } from "@/server/grafts/registry";

export const GET = handle(async () => {
  const user = await authed();
  await requireGraftEnabled("greenhouse");
  return ok({ workspaces: await listUserWorkspaces(user.id) });
});

export const POST = handle(async (req) => {
  const user = await authed();
  await requireGraftEnabled("greenhouse");
  const id = await createWorkspace(user.id, await readJson(req, createWorkspaceInput));
  return ok({ id }, 201);
});

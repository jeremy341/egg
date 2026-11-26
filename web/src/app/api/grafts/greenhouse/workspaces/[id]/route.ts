import { authed, handle, ok, readJson } from "@/server/http";
import { deleteWorkspace, getWorkspace, updateWorkspace, updateWorkspaceInput } from "@/server/grafts/greenhouse";
import { requireGraftEnabled } from "@/server/grafts/registry";

type Context = { params: Promise<{ id: string }> };

export const GET = handle<Context>(async (_req, { params }) => {
  const user = await authed();
  await requireGraftEnabled("greenhouse");
  const { id } = await params;
  return ok(await getWorkspace(user.id, id));
});

export const PATCH = handle<Context>(async (req, { params }) => {
  const user = await authed();
  await requireGraftEnabled("greenhouse");
  const { id } = await params;
  await updateWorkspace(user.id, id, await readJson(req, updateWorkspaceInput));
  return ok({ updated: true });
});

export const DELETE = handle<Context>(async (_req, { params }) => {
  const user = await authed();
  await requireGraftEnabled("greenhouse");
  const { id } = await params;
  await deleteWorkspace(id, user.id, false);
  return ok({ deleted: true });
});

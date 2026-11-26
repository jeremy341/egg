import { authed, handle, ok } from "@/server/http";
import { deleteForumThread, getForumThread } from "@/server/grafts/forum";
import { isInstanceAdmin } from "@/server/admin-identity";
import { requireGraftEnabled } from "@/server/grafts/registry";

type Context = { params: Promise<{ id: string }> };

export const GET = handle<Context>(async (_req, { params }) => {
  const user = await authed();
  await requireGraftEnabled("forum");
  const { id } = await params;
  return ok(await getForumThread(user.id, id));
});

export const DELETE = handle<Context>(async (_req, { params }) => {
  const user = await authed();
  await requireGraftEnabled("forum");
  const { id } = await params;
  await deleteForumThread(user.id, id, await isInstanceAdmin(user.id));
  return ok({ deleted: true });
});

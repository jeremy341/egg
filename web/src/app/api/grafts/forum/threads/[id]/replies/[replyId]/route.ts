import { isInstanceAdmin } from "@/server/admin-identity";
import { authed, handle, ok } from "@/server/http";
import { deleteForumReply } from "@/server/grafts/forum";
import { requireGraftEnabled } from "@/server/grafts/registry";

type Context = { params: Promise<{ id: string; replyId: string }> };

export const DELETE = handle<Context>(async (_req, { params }) => {
  const user = await authed();
  await requireGraftEnabled("forum");
  const { id, replyId } = await params;
  await deleteForumReply(user.id, id, replyId, await isInstanceAdmin(user.id));
  return ok({ deleted: true });
});

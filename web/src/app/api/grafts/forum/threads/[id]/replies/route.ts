import { authed, handle, ok, readJson } from "@/server/http";
import { createForumReply, createReplyInput } from "@/server/grafts/forum";
import { requireGraftEnabled } from "@/server/grafts/registry";

type Context = { params: Promise<{ id: string }> };

export const POST = handle<Context>(async (req, { params }) => {
  const user = await authed();
  await requireGraftEnabled("forum");
  const { id } = await params;
  await createForumReply(user.id, id, await readJson(req, createReplyInput));
  return ok({ created: true }, 201);
});

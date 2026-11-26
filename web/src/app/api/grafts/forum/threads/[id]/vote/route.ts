import { authed, handle, ok } from "@/server/http";
import { setForumVote } from "@/server/grafts/forum";
import { requireGraftEnabled } from "@/server/grafts/registry";

type Context = { params: Promise<{ id: string }> };

export const POST = handle<Context>(async (_req, { params }) => {
  const user = await authed();
  await requireGraftEnabled("forum");
  const { id } = await params;
  await setForumVote(user.id, id, true);
  return ok({ voted: true });
});

export const DELETE = handle<Context>(async (_req, { params }) => {
  const user = await authed();
  await requireGraftEnabled("forum");
  const { id } = await params;
  await setForumVote(user.id, id, false);
  return ok({ voted: false });
});

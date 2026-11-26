import { authed, handle, ok, readJson } from "@/server/http";
import { createForumThread, createThreadInput, listForumThreads } from "@/server/grafts/forum";
import { requireGraftEnabled } from "@/server/grafts/registry";

export const GET = handle(async () => {
  const user = await authed();
  await requireGraftEnabled("forum");
  return ok({ threads: await listForumThreads(user.id) });
});

export const POST = handle(async (req) => {
  const user = await authed();
  await requireGraftEnabled("forum");
  const id = await createForumThread(user.id, await readJson(req, createThreadInput));
  return ok({ id }, 201);
});

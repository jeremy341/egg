import { audit } from "@/server/audit";
import { authed, handle, ok, readJson } from "@/server/http";
import { moderateForumThread, moderateThreadInput } from "@/server/grafts/forum";
import { requireGraftAdmin, requireGraftEnabled } from "@/server/grafts/registry";

type Context = { params: Promise<{ id: string }> };

export const PATCH = handle<Context>(async (req, { params }) => {
  const user = await authed();
  await requireGraftAdmin(user.id);
  await requireGraftEnabled("forum");
  const { id } = await params;
  await moderateForumThread(id, await readJson(req, moderateThreadInput));
  await audit(user.id, "graft.forum.moderate", id, undefined, { level: "instance" });
  return ok({ updated: true });
});

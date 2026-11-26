import { audit } from "@/server/audit";
import { authed, handle, ok } from "@/server/http";
import { deleteWorkspace } from "@/server/grafts/greenhouse";
import { requireGraftAdmin, requireGraftEnabled } from "@/server/grafts/registry";

type Context = { params: Promise<{ id: string }> };

export const DELETE = handle<Context>(async (_req, { params }) => {
  const user = await authed();
  await requireGraftAdmin(user.id);
  await requireGraftEnabled("greenhouse");
  const { id } = await params;
  await deleteWorkspace(id, user.id, true);
  await audit(user.id, "graft.greenhouse.delete", id, undefined, { level: "instance" });
  return ok({ deleted: true });
});

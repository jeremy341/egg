import { authed, handle, ok } from "@/server/http";
import { revokeProjectInvitation } from "@/server/project-roles";

type Ctx = { params: Promise<{ id: string; invitationId: string }> };
export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id, invitationId } = await params;
  await revokeProjectInvitation(user.id, id, invitationId);
  return ok({ ok: true });
});

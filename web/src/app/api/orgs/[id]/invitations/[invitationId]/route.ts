import { authed, handle, ok } from "@/server/http";
import { assertInvitationInOrg, cancelInvitation } from "@/server/invitations";
import { assertOrgRole } from "@/server/organizations";

type Ctx = { params: Promise<{ id: string; invitationId: string }> };

/** Cancel a pending invitation. Its link stops working at once. Admins only. */
export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id, invitationId } = await params;
  await assertOrgRole(user.id, id, "admin");
  await assertInvitationInOrg(invitationId, id);
  await cancelInvitation(user.id, invitationId);
  return ok({ ok: true });
});

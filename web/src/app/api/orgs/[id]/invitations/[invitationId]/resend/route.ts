import { authed, handle, ok } from "@/server/http";
import { assertOrgRole } from "@/server/organizations";
import { assertInvitationInOrg, resendInvitation } from "@/server/invitations";

type Ctx = { params: Promise<{ id: string; invitationId: string }> };

/** Issue a new link. The old link stops working at once. Admins only. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id, invitationId } = await params;
  await assertOrgRole(user.id, id, "admin");
  await assertInvitationInOrg(invitationId, id);
  return ok({ invitation: await resendInvitation(user.id, invitationId) });
});

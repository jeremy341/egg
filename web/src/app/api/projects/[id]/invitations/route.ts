import { authed, handle, ok, readJson } from "@/server/http";
import { createProjectInvitation, listProjectInvitations, invitationInput } from "@/server/project-roles";

type Ctx = { params: Promise<{ id: string }> };
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  return ok({ invitations: await listProjectInvitations(user.id, (await params).id) });
});
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  return ok(await createProjectInvitation(user.id, (await params).id, await readJson(req, invitationInput)), 201);
});

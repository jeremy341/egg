import { authed, handle, ok } from "@/server/http";
import { listOrgMembers } from "@/server/organizations";

type Ctx = { params: Promise<{ id: string }> };

/** Everyone in the organization. Any member can see the list. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok({ members: await listOrgMembers(user.id, id) });
});

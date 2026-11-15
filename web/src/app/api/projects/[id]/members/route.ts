import { authed, handle, ok } from "@/server/http";
import { listProjectMembers } from "@/server/project-roles";

type Ctx = { params: Promise<{ id: string }> };
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  return ok({ members: await listProjectMembers(user.id, (await params).id) });
});

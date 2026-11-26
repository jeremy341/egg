import { authed, handle, ok } from "@/server/http";
import { leaveOrganization } from "@/server/organizations";

type Ctx = { params: Promise<{ id: string }> };

/** Leave an organization. Owners must hand over the owner role first. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  await leaveOrganization(user.id, id);
  return ok({ ok: true });
});

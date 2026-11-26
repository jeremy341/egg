import { z } from "zod";
import { ORG_ROLES } from "@/server/db/schema";
import { authed, handle, ok, readJson } from "@/server/http";
import { changeMemberRole, removeOrgMember } from "@/server/organizations";

type Ctx = { params: Promise<{ id: string; userId: string }> };

/** Change a member's role. Owners only. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id, userId } = await params;
  const body = await readJson(req, z.object({ role: z.enum(ORG_ROLES) }));
  await changeMemberRole(user.id, id, userId, body.role);
  return ok({ ok: true });
});

/** Remove a member. Owners can remove anyone; admins can remove members and guests. */
export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id, userId } = await params;
  await removeOrgMember(user.id, id, userId);
  return ok({ ok: true });
});

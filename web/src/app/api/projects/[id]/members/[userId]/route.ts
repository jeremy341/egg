import { z } from "zod";
import { PROJECT_ROLES } from "@/server/db/schema";
import { authed, handle, ok, readJson } from "@/server/http";
import { changeProjectMemberRole, removeProjectMember } from "@/server/project-members";

type Ctx = { params: Promise<{ id: string; userId: string }> };

/** Change a member's project role. Project admins only. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id, userId } = await params;
  const body = await readJson(req, z.object({ role: z.enum(PROJECT_ROLES) }));
  await changeProjectMemberRole(user.id, id, userId, body.role);
  return ok({ ok: true });
});

/** Remove a member from the project. Project admins only. */
export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id, userId } = await params;
  await removeProjectMember(user.id, id, userId);
  return ok({ ok: true });
});

import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { removeProjectMember, setProjectMemberRole } from "@/server/project-roles";

type Ctx = { params: Promise<{ id: string; memberId: string }> };
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id, memberId } = await params;
  const { role } = await readJson(req, z.object({ role: z.enum(["viewer", "developer"]) }));
  await setProjectMemberRole(user.id, id, memberId, role);
  return ok({ ok: true });
});
export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id, memberId } = await params;
  await removeProjectMember(user.id, id, memberId);
  return ok({ ok: true });
});

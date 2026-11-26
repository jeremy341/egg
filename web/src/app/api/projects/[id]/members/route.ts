import { z } from "zod";
import { PROJECT_ROLES } from "@/server/db/schema";
import { authed, handle, ok, readJson } from "@/server/http";
import { addProjectMember, listProjectMembers } from "@/server/project-members";

type Ctx = { params: Promise<{ id: string }> };

/** Everyone with a project role. Anyone who can view the project. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok({ members: await listProjectMembers(user.id, id) });
});

/** Add a person by account email. Project admins only. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const body = await readJson(req, z.object({ email: z.string().max(254), role: z.enum(PROJECT_ROLES) }));
  return ok({ member: await addProjectMember(user.id, id, body) }, 201);
});

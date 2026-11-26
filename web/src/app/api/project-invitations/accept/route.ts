import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { acceptProjectInvitation } from "@/server/project-roles";

export const POST = handle(async (req) => {
  const user = await authed();
  const { token } = await readJson(req, z.object({ token: z.string().min(1).max(256) }));
  return ok(await acceptProjectInvitation(user.id, token));
});

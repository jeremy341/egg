import { z } from "zod";
import { authed, handle, HttpError, ok, readJson } from "@/server/http";
import { getActiveProjectCleanup, requestProjectCleanup } from "@/server/cleanup";
import { getProjectAtLevel } from "@/server/projects";
type Ctx = { params: Promise<{ id: string }> };
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  await getProjectAtLevel(user.id, id, "view");
  return ok({ cleanup: await getActiveProjectCleanup(user.id, id) });
});
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const project = await getProjectAtLevel(user.id, id, "admin");
  const body = await readJson(req, z.object({ confirm: z.string().max(100) }));
  if (body.confirm !== project.slug) throw new HttpError(400, "Type the project slug exactly to confirm.", "validation");
  return ok({ cleanup: await requestProjectCleanup(user.id, id) }, 202);
});

import { readJsonLimited } from "@/server/body-limit";
import { authed, handle, ok } from "@/server/http";
import { deleteProject } from "@/server/project-delete";
import { getProjectForUser, updateProject, projectResponse } from "@/server/projects";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok({ project: projectResponse(await getProjectForUser(user.id, id)) });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const body = await readJsonLimited(req, { fallback: {} });
  return ok({ project: projectResponse(await updateProject(user.id, id, body)) });
});

/**
 * ?remote=1 also stops the service and deletes the releases on Nest first, and
 * ?data=1 deletes the project's shared data folder too. Without them only the
 * records are removed and the app keeps running.
 */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const q = req.nextUrl.searchParams;
  await deleteProject(user.id, id, { remote: q.get("remote") === "1", deleteData: q.get("data") === "1" });
  return ok({ ok: true });
});

import { readJsonLimited } from "@/server/body-limit";
import { authed, handle, ok } from "@/server/http";
import { createProject, listProjects, projectResponse } from "@/server/projects";

export const GET = handle(async () => {
  const user = await authed();
  // listProjects, the dashboard (projectViews) and v1 list_projects all use the
  // same owner predicate, so their project lists agree.
  return ok({ projects: (await listProjects(user.id)).map(projectResponse) });
});

export const POST = handle(async (req) => {
  const user = await authed();
  const body = await readJsonLimited(req, { fallback: {} });
  return ok({ project: projectResponse(await createProject(user.id, body)) }, 201);
});

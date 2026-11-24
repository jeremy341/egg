import { authed, handle, ok } from "@/server/http";
import { projectResponse } from "@/server/projects";
import { restoreTrashedProject } from "@/server/project-trash";

type Ctx = { params: Promise<{ trashId: string }> };

/** Put a trashed app back with its records. The service on the server is not redeployed. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { trashId } = await params;
  return ok({ project: projectResponse(await restoreTrashedProject(user.id, trashId)) });
});

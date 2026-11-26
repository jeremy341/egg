import { authed, handle, ok } from "@/server/http";
import { listTrashedProjects } from "@/server/project-trash";

/** Apps in the trash ("Recently deleted"), with the date each one is removed for good. */
export const GET = handle(async () => {
  const user = await authed();
  return ok({ projects: await listTrashedProjects(user.id) });
});

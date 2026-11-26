import { authed, handle, ok } from "@/server/http";
import { readableDeployment } from "@/server/projects";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const { dep, project } = await readableDeployment(user.id, id);
  return ok({
    deployment: { ...dep, port: project.workloadKind === "worker" ? null : dep.port },
    project: { id: project.id, name: project.name, slug: project.slug },
  });
});

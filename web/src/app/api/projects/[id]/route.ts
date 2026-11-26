import { readJsonLimited } from "@/server/body-limit";
import { authed, handle, ok } from "@/server/http";
import { deleteProject } from "@/server/project-delete";
import { getProjectForUser, getReadableProject, updateProject, projectResponse } from "@/server/projects";
import { getProjectRole } from "@/server/project-roles";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  if ((await getProjectRole(user.id, id)) === "owner") return ok({ project: projectResponse(await getProjectForUser(user.id, id)) });
  const p = await getReadableProject(user.id, id);
  return ok({ project: { id: p.id, name: p.name, slug: p.slug, repoUrl: p.repoUrl, repoFullName: p.repoFullName,
    productionBranch: p.productionBranch, rootDir: p.rootDir, runtime: p.runtime, installCommand: p.installCommand,
    buildCommand: p.buildCommand, startCommand: p.startCommand, outputDir: p.outputDir, buildLocation: p.buildLocation,
    port: p.workloadKind === "worker" ? null : p.port, listenPort: p.workloadKind === "worker" ? null : p.listenPort ?? p.port,
    workloadKind: p.workloadKind, deploymentMode: p.deploymentMode, healthPath: p.workloadKind === "worker" ? null : p.healthPath, autoDeploy: p.autoDeploy, monitorState: p.monitorState,
    createdAt: p.createdAt, updatedAt: p.updatedAt } });
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

import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { apiCreateProject, apiDeleteProject, apiUpdateProject } from "@/server/api-v1-more";
import { domainIdInput, endpoint, flagInput, NOT_FOUND_NOTE, projectIdInput, serverIdInput, type Endpoint } from "@/server/api-v1-kit";
import { domainSchema, latestFor, paginateList, projectSchema, publicDomainFor, toProject } from "@/server/api-v1-models";
import { projectViews } from "@/server/queries";
import { createProjectInput, getProjectForUser } from "@/server/projects";
import { updateDomain } from "@/server/domains";
import { HttpError } from "@/server/http";

const create = createProjectInput.shape;
const createBody = {
  serverId: serverIdInput.describe("The owner's server that will host the service."),
  name: create.name,
  slug: create.slug,
  repoUrl: create.repoUrl,
  productionBranch: create.productionBranch,
  rootDir: create.rootDir,
  runtime: create.runtime,
  workloadKind: create.workloadKind,
  deploymentMode: create.deploymentMode,
  installCommand: create.installCommand,
  buildCommand: create.buildCommand,
  startCommand: create.startCommand,
  outputDir: create.outputDir,
  port: create.port,
  healthPath: create.healthPath,
  autoDeploy: create.autoDeploy,
};
const publicPortInput = z.object({ port: z.number().int().min(1024).max(65535) });

export async function apiCreateService(p: Principal, input: Parameters<typeof apiCreateProject>[1]) {
  return { service: (await apiCreateProject(p, input)).project };
}

export async function apiListServices(p: Principal, limit = 100, cursor?: string) {
  requireScope(p, "projects:read");
  const views = await projectViews(p.userId);
  const latest = await Promise.all(views.map((view) => latestFor(p.userId, view)));
  const services = views.map((view, index) => toProject(view, latest[index]));
  return { services, ...paginateList(services, { limit, cursor }, (service) => service.id) };
}

export async function apiSetServiceExposure(p: Principal, serviceId: string, domainId: string, exposed: boolean) {
  requireScope(p, "domains:write");
  await getProjectForUser(p.userId, serviceId);
  const updated = await updateDomain(p.userId, domainId, { projectId: exposed ? serviceId : null });
  return { domain: await publicDomainFor(p, domainId), exposed, needsNestChange: updated.needsNestChange, instructions: updated.instructions };
}

export async function apiSetServicePortPublic(p: Principal, serviceId: string, port: number) {
  requireScope(p, "projects:write");
  return apiUpdateProject(p, serviceId, { port });
}

export const SERVICES_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "list_services", method: "GET", path: "/services", scope: "projects:read", bucket: "read", tag: "Projects", summary: "List services",
    description: `List the owner's deployable services using public project fields only; credentials are not included. ${NOT_FOUND_NOTE}`,
    query: { limit: z.coerce.number().int().min(1).max(100).default(100), cursor: z.string().max(200).optional() },
    response: z.object({ services: z.array(projectSchema), items: z.array(projectSchema), total: z.number().int(), nextCursor: z.string().nullable() }),
    errors: [400], run: (p, i) => apiListServices(p, i.limit, i.cursor),
  }),
  endpoint({
    id: "create_service", method: "POST", path: "/services", scope: "projects:write", bucket: "write", status: 201, tag: "Projects", summary: "Create a service",
    description: "Create a service through the existing project workflow on one of the owner's servers. Creating it does not deploy it.",
    body: createBody, response: z.object({ service: projectSchema }), errors: [400, 404, 409], run: (p, i) => apiCreateService(p, i),
  }),
  endpoint({
    id: "delete_service", method: "DELETE", path: "/services/{serviceId}", scope: "projects:write", bucket: "write", tag: "Projects", summary: "Delete a service",
    description: `Permanently delete an owner's service through the existing project deletion workflow. Confirm with its exact name. ${NOT_FOUND_NOTE}`,
    pathParams: { serviceId: projectIdInput }, query: { removeFromServer: flagInput.optional() }, body: { confirmName: z.string().min(1).max(100) },
    response: z.object({ deleted: z.boolean(), projectId: z.string(), removedFromServer: z.boolean() }), errors: [400, 404, 502], destructive: true,
    run: (p, i) => apiDeleteProject(p, i.serviceId, i.confirmName, i.removeFromServer ?? false),
  }),
  endpoint({
    id: "set_service_exposure", method: "PATCH", path: "/services/{serviceId}/exposure", scope: "domains:write", bucket: "write", tag: "Domains", summary: "Set service exposure",
    description: `Attach or detach an owner's domain from the service. Attaching assigns the service's configured port. ${NOT_FOUND_NOTE}`,
    pathParams: { serviceId: projectIdInput }, body: { domainId: domainIdInput, exposed: z.boolean() },
    response: z.object({ domain: domainSchema, exposed: z.boolean(), needsNestChange: z.boolean(), instructions: z.unknown().nullable() }), errors: [400, 404],
    run: (p, i) => apiSetServiceExposure(p, i.serviceId, i.domainId, i.exposed),
  }),
  endpoint({
    id: "set_service_port_public", method: "PATCH", path: "/services/{serviceId}/port", scope: "projects:write", bucket: "write", tag: "Projects", summary: "Change an exposed service port",
    description: `Change the service's public listen port. Linked domains are updated by the existing project service and returned to pending until the Nest dashboard mapping is changed. ${NOT_FOUND_NOTE}`,
    pathParams: { serviceId: projectIdInput }, body: publicPortInput.shape,
    response: z.object({ project: projectSchema }), errors: [400, 404, 409],
    run: (p, i) => apiSetServicePortPublic(p, i.serviceId, i.port),
  }),
];

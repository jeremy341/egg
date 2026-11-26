import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { apiDeleteProject } from "@/server/api-v1-more";
import { tagAudit } from "@/server/api-v1-audit";
import {
  deploymentIdInput,
  endpoint,
  flagInput,
  NOT_FOUND_NOTE,
  serverIdInput,
  type Endpoint,
} from "@/server/api-v1-kit";
import { deploymentSchema, projectSchema, publicProjectFor, requireView, toDeployment } from "@/server/api-v1-models";
import { HttpError } from "@/server/http";
import { operateDeployment } from "@/server/deploy/lifecycle";
import { createProject, createProjectInput, getProjectForUser, redeploy, updateProject } from "@/server/projects";

const deploymentId = deploymentIdInput.describe("The project or deployment id, as specified by the operation.");
const projectName = z.string().trim().min(1).max(60);
const create = createProjectInput.shape;
const createBody = {
  serverId: serverIdInput,
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
const buildConfigBody = {
  productionBranch: create.productionBranch.removeDefault().optional(),
  rootDir: create.rootDir.removeDefault().optional(),
  runtime: create.runtime.optional(),
  installCommand: create.installCommand.optional(),
  buildCommand: create.buildCommand.optional(),
  startCommand: create.startCommand.optional(),
  outputDir: create.outputDir.optional(),
  buildLocation: create.buildLocation.optional(),
  buildCacheEnabled: create.buildCacheEnabled.optional(),
};
const projectResponse = z.object({ project: projectSchema });
const deploymentResponse = z.object({ deployment: deploymentSchema });
const scaleBody = {
  memoryMb: z.number().int().min(128).max(32768).optional(),
  cpuPercent: z.number().int().min(1).max(6400).optional(),
};

async function updateDeploymentProject(p: Principal, id: string, changes: Record<string, unknown>, action: string) {
  requireScope(p, "projects:write");
  const changedFields = Object.keys(changes);
  if (changedFields.length === 0) throw new HttpError(400, "Send at least one setting to change.", "validation");
  await getProjectForUser(p.userId, id);
  await tagAudit(p, action, () => updateProject(p.userId, id, changes), { fields: changedFields.join(", ") });
  return { project: await publicProjectFor(p, id) };
}

export async function apiCreateDeployment(p: Principal, input: z.output<z.ZodObject<typeof createBody>>) {
  requireScope(p, "projects:write");
  const project = await tagAudit(p, "project.create", () => createProject(p.userId, input), { name: input.name });
  return { project: await publicProjectFor(p, project.id) };
}

export async function apiRenameDeployment(p: Principal, id: string, name: string) {
  return updateDeploymentProject(p, id, { name }, "project.update");
}

export async function apiRetryDeploymentApply(p: Principal, id: string) {
  requireScope(p, "deployments:write");
  const created = await redeploy(p.userId, id, { tokenId: p.tokenId });
  return { deployment: toDeployment(await requireView(p, created.id)) };
}

export async function apiUpdateDeploymentResources(
  p: Principal,
  id: string,
  input: z.output<z.ZodObject<typeof scaleBody>>
) {
  requireScope(p, "deployments:write");
  if (input.memoryMb === undefined && input.cpuPercent === undefined) {
    throw new HttpError(400, "Set a memory or CPU limit to change deployment resources.", "validation");
  }
  return operateDeployment(p.userId, id, { action: "scale", ...input });
}

export const DEPLOYMENT_CRUD_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "create_deployment",
    method: "POST",
    path: "/deployments",
    scope: "projects:write",
    bucket: "write",
    status: 201,
    tag: "Deployments",
    summary: "Create a deployment project",
    description: `Create a project configuration on one of your servers. This does not build or start it; call deploy_branch afterwards. ${NOT_FOUND_NOTE}`,
    body: createBody,
    response: projectResponse,
    errors: [400, 404, 409],
    run: (p, i) => apiCreateDeployment(p, i),
  }),
  endpoint({
    id: "delete_deployment",
    method: "DELETE",
    path: "/deployments/{deploymentId}",
    scope: "projects:write",
    bucket: "write",
    tag: "Deployments",
    summary: "Delete a deployment project",
    description: `Permanently delete a project and its deployment records. Pass its exact project name as confirmName. Set removeFromServer to also remove its service and releases from the container; the shared data folder is kept. ${NOT_FOUND_NOTE}`,
    pathParams: { deploymentId },
    query: { removeFromServer: flagInput.optional() },
    body: { confirmName: z.string().min(1).max(100) },
    response: z.object({ deleted: z.boolean(), projectId: z.string(), removedFromServer: z.boolean() }),
    errors: [400, 404, 409, 502],
    destructive: true,
    run: (p, i) => apiDeleteProject(p, i.deploymentId, i.confirmName, i.removeFromServer ?? false),
  }),
  endpoint({
    id: "rename_deployment",
    method: "PATCH",
    path: "/deployments/{deploymentId}/name",
    scope: "projects:write",
    bucket: "write",
    tag: "Deployments",
    summary: "Rename a deployment project",
    description: `Change the project's display name. The existing slug and service identity remain unchanged. ${NOT_FOUND_NOTE}`,
    pathParams: { deploymentId },
    body: { name: projectName },
    response: projectResponse,
    errors: [400, 404, 409],
    run: (p, i) => apiRenameDeployment(p, i.deploymentId, i.name),
  }),
  endpoint({
    id: "retry_deployment_apply",
    method: "POST",
    path: "/deployments/{deploymentId}/retry-apply",
    scope: "deployments:write",
    bucket: "write",
    status: 202,
    tag: "Deployments",
    summary: "Retry a deployment",
    description: `Queue a fresh build of the same commit as a new deployment. This is a redeploy, not a retry of the previous worker job. ${NOT_FOUND_NOTE}`,
    pathParams: { deploymentId },
    response: deploymentResponse,
    errors: [400, 404, 409],
    run: (p, i) => apiRetryDeploymentApply(p, i.deploymentId),
  }),
  endpoint({
    id: "update_deployment_build_config",
    method: "PATCH",
    path: "/deployments/{deploymentId}/build-config",
    scope: "projects:write",
    bucket: "write",
    tag: "Deployments",
    summary: "Update deployment build settings",
    description: `Update only the supplied build and source settings. Changes apply on the next deployment; this call does not start one. ${NOT_FOUND_NOTE}`,
    pathParams: { deploymentId },
    body: buildConfigBody,
    response: projectResponse,
    errors: [400, 404, 409],
    run: (p, i) => {
      const { deploymentId: id, ...changes } = i;
      return updateDeploymentProject(p, id, changes, "project.update");
    },
  }),
  endpoint({
    id: "update_deployment_health_check",
    method: "PATCH",
    path: "/deployments/{deploymentId}/health-check",
    scope: "projects:write",
    bucket: "write",
    tag: "Deployments",
    summary: "Update the deployment health check",
    description: `Set the path used by the project's health checks. The new path is checked by future monitoring runs. ${NOT_FOUND_NOTE}`,
    pathParams: { deploymentId },
    body: { healthPath: create.healthPath.removeDefault() },
    response: projectResponse,
    errors: [400, 404],
    run: (p, i) => updateDeploymentProject(p, i.deploymentId, { healthPath: i.healthPath }, "project.update"),
  }),
  endpoint({
    id: "update_deployment_image",
    method: "PATCH",
    path: "/deployments/{deploymentId}/image",
    scope: "projects:write",
    bucket: "write",
    tag: "Deployments",
    summary: "Update the deployment image",
    description: `Set or clear the image reference for an image-mode project. ${NOT_FOUND_NOTE}`,
    pathParams: { deploymentId },
    body: { imageRef: create.imageRef },
    response: projectResponse,
    errors: [400, 404],
    run: (p, i) => updateDeploymentProject(p, i.deploymentId, { imageRef: i.imageRef }, "project.update"),
  }),
  endpoint({
    id: "update_deployment_pull_policy",
    method: "PATCH",
    path: "/deployments/{deploymentId}/pull-policy",
    scope: "projects:write",
    bucket: "write",
    tag: "Deployments",
    summary: "Update the deployment image pull policy",
    description: `Choose when Docker pulls the configured image. This setting applies only to image-mode projects. ${NOT_FOUND_NOTE}`,
    pathParams: { deploymentId },
    body: { pullPolicy: create.pullPolicy },
    response: projectResponse,
    errors: [400, 404],
    run: (p, i) => updateDeploymentProject(p, i.deploymentId, { pullPolicy: i.pullPolicy }, "project.update"),
  }),
  endpoint({
    id: "update_deployment_strategy",
    method: "PATCH",
    path: "/deployments/{deploymentId}/strategy",
    scope: "projects:write",
    bucket: "write",
    tag: "Deployments",
    summary: "Update the deployment strategy",
    description: `Set the supported project deployment strategy. Compose projects with persistent volumes may require recreate. ${NOT_FOUND_NOTE}`,
    pathParams: { deploymentId },
    body: { deployStrategy: create.deployStrategy },
    response: projectResponse,
    errors: [400, 404],
    run: (p, i) => updateDeploymentProject(p, i.deploymentId, { deployStrategy: i.deployStrategy }, "project.update"),
  }),
  endpoint({
    id: "update_deployment_resources",
    method: "PATCH",
    path: "/deployments/{deploymentId}/resources",
    scope: "deployments:write",
    bucket: "ssh",
    tag: "Deployments",
    summary: "Update deployment resource limits",
    description: `Change the current retained production service's memory or CPU limits on its container. This opens an SSH session; previews and old releases cannot be changed. ${NOT_FOUND_NOTE}`,
    pathParams: { deploymentId },
    body: scaleBody,
    response: z.object({ action: z.literal("scale"), deploymentId: z.string(), output: z.string() }),
    errors: [400, 404, 409, 502],
    run: (p, i) => {
      const { deploymentId: id, ...limits } = i;
      return apiUpdateDeploymentResources(p, id, limits);
    },
  }),
  endpoint({
    id: "update_deployment_volumes",
    method: "PATCH",
    path: "/deployments/{deploymentId}/volumes",
    scope: "projects:write",
    bucket: "write",
    tag: "Deployments",
    summary: "Update deployment volume settings",
    description: `Volume mounts are declared in the project's Compose file. Egg does not expose an API for editing mount definitions, so this operation is explicitly unsupported. ${NOT_FOUND_NOTE}`,
    pathParams: { deploymentId },
    body: { volumes: z.array(z.string().trim().min(1).max(255)).max(64) },
    response: projectResponse,
    errors: [400, 404, 501],
    run: async () => {
      throw new HttpError(501, "Volume mounts must be changed in the project's Compose file; this API cannot edit them.", "not_supported");
    },
  }),
];


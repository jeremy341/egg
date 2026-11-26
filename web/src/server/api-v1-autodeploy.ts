import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { tagAudit } from "@/server/api-v1-audit";
import { endpoint, NOT_FOUND_NOTE, projectIdInput, type Endpoint } from "@/server/api-v1-kit";
import { getProjectForUser, updateProject } from "@/server/projects";

/**
 * The auto-deploy switch for agents: read it, turn it on, turn it off. The
 * switch is the project's existing `autoDeploy` field, so these calls change
 * exactly what the dashboard's settings form changes and take effect on the
 * next push. None of them starts or cancels a deployment.
 */

const autoDeploySchema = z.object({
  projectId: z.string(),
  autoDeploy: z.boolean().describe("True when a push to the watched branch deploys the project automatically."),
  repo: z.string().nullable().describe("Watched repository as owner/name, or null when no repository is linked."),
  branch: z.string().describe("Branch whose pushes deploy the project."),
});

const changedSchema = z.object({
  projectId: z.string(),
  autoDeploy: z.boolean().describe("The switch after this call."),
});

/** Read the switch and the push source it applies to, without touching either. */
export async function apiGetAutoDeployStatus(p: Principal, projectId: string) {
  requireScope(p, "projects:read");
  const project = await getProjectForUser(p.userId, projectId);
  return {
    projectId: project.id,
    autoDeploy: project.autoDeploy,
    repo: project.repoFullName,
    branch: project.productionBranch,
  };
}

/**
 * Flip the existing project field through the same service the dashboard uses,
 * so its checks (a push source must be configured before enabling) and its
 * audit entry are the same too. The token that made the change is tagged on
 * that entry.
 */
async function setAutoDeploy(p: Principal, projectId: string, autoDeploy: boolean) {
  requireScope(p, "projects:write");
  // Ownership first: someone else's project is a 404 whatever was sent.
  await getProjectForUser(p.userId, projectId);
  const project = await tagAudit(p, "project.update", () => updateProject(p.userId, projectId, { autoDeploy }), {
    fields: "autoDeploy",
  });
  return { projectId: project.id, autoDeploy: project.autoDeploy };
}

export async function apiEnableAutoDeploy(p: Principal, projectId: string) {
  return setAutoDeploy(p, projectId, true);
}

export async function apiDisableAutoDeploy(p: Principal, projectId: string) {
  return setAutoDeploy(p, projectId, false);
}

const projectId = projectIdInput;

export const AUTODEPLOY_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "get_auto_deploy_status",
    method: "GET",
    path: "/projects/{projectId}/auto-deploy",
    scope: "projects:read",
    bucket: "read",
    tag: "Projects",
    summary: "Read the auto-deploy switch",
    description: `Read whether pushes deploy this project automatically, which repository is watched and which branch triggers a deploy. This only reports the project's setting: it does not check the provider connection or start a deployment. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId },
    response: autoDeploySchema,
    errors: [400, 404],
    run: (p, i) => apiGetAutoDeployStatus(p, i.projectId),
  }),
  endpoint({
    id: "enable_auto_deploy",
    method: "PUT",
    path: "/projects/{projectId}/auto-deploy",
    scope: "projects:write",
    bucket: "write",
    tag: "Projects",
    summary: "Turn on auto-deploy",
    description: `Make pushes to the project's production branch deploy it automatically, the same setting the dashboard's Auto deploy switch uses. It does not deploy anything now. Needs projects:write and a configured push source: returns 400 for an image app or a project without a GitHub link or provider webhook. Calling it when auto-deploy is already on changes nothing. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId },
    response: changedSchema,
    errors: [400, 404],
    run: (p, i) => apiEnableAutoDeploy(p, i.projectId),
  }),
  endpoint({
    id: "disable_auto_deploy",
    method: "DELETE",
    path: "/projects/{projectId}/auto-deploy",
    scope: "projects:write",
    bucket: "write",
    tag: "Projects",
    summary: "Turn off auto-deploy",
    description: `Stop pushes from deploying this project automatically; manual deploys and deploy hooks keep working. A deployment already running is not canceled. Needs projects:write and takes effect on the next push. Calling it when auto-deploy is already off changes nothing. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId },
    response: changedSchema,
    errors: [400, 404],
    run: (p, i) => apiDisableAutoDeploy(p, i.projectId),
  }),
];

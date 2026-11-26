import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { endpoint, NOT_FOUND_NOTE, projectIdInput, type Endpoint } from "@/server/api-v1-kit";
import { deploymentSummarySchema, toDeployment } from "@/server/api-v1-models";
import { getReadableProject } from "@/server/projects";
import { deploymentPage } from "@/server/queries";

export async function apiGetImageHistory(p: Principal, projectId: string) {
  requireScope(p, "projects:read");
  const project = await getReadableProject(p.userId, projectId);
  return {
    projectId,
    imageRef: project.imageRef,
    deploymentMode: project.deploymentMode,
    pullPolicy: project.pullPolicy,
    historyAvailable: false as const,
  };
}

export async function apiListBuildRuns(p: Principal, projectId: string, limit: number, cursor?: string) {
  requireScope(p, "deployments:read");
  const page = await deploymentPage(p.userId, { projectId, limit, cursor });
  return { projectId, runs: page.rows.map(toDeployment), nextCursor: page.nextCursor };
}

export async function apiGetObservabilityLink(p: Principal, projectId: string) {
  requireScope(p, "projects:read");
  const project = await getReadableProject(p.userId, projectId);
  const slug = encodeURIComponent(project.slug);
  return {
    projectId,
    projectUrl: `/projects/${slug}`,
    analyticsUrl: `/projects/${slug}/analytics`,
    monitorState: project.monitorState,
  };
}

export const IMAGE_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "get_image_history",
    method: "GET",
    path: "/projects/{projectId}/image-history",
    scope: "projects:read",
    bucket: "read",
    tag: "Deployments",
    summary: "Read configured image details",
    description: `Read a project's currently configured container image and pull policy. Egg does not retain historical image references, so this is current configuration rather than an image history. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId: projectIdInput },
    response: z.object({
      projectId: z.string(),
      imageRef: z.string().nullable(),
      deploymentMode: z.string(),
      pullPolicy: z.string(),
      historyAvailable: z.literal(false),
    }),
    errors: [404],
    run: (p, i) => apiGetImageHistory(p, i.projectId),
  }),
  endpoint({
    id: "list_build_runs",
    method: "GET",
    path: "/projects/{projectId}/build-runs",
    scope: "deployments:read",
    bucket: "read",
    tag: "Deployments",
    summary: "List build and deployment runs",
    description: `List a project's build and deployment runs, newest first, using its retained deployment records. Pass nextCursor to continue. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId: projectIdInput },
    query: {
      limit: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.string().max(200).optional(),
    },
    response: z.object({ projectId: z.string(), runs: z.array(deploymentSummarySchema), nextCursor: z.string().nullable() }),
    errors: [400, 404],
    run: (p, i) => apiListBuildRuns(p, i.projectId, i.limit, i.cursor),
  }),
  endpoint({
    id: "get_observability_link",
    method: "GET",
    path: "/projects/{projectId}/observability-link",
    scope: "projects:read",
    bucket: "read",
    tag: "Analytics",
    summary: "Get project observability links",
    description: `Get the project's monitoring view and analytics page links within Egg, along with its latest monitor state. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId: projectIdInput },
    response: z.object({
      projectId: z.string(),
      projectUrl: z.string(),
      analyticsUrl: z.string(),
      monitorState: z.enum(["unknown", "up", "down"]),
    }),
    errors: [404],
    run: (p, i) => apiGetObservabilityLink(p, i.projectId),
  }),
];

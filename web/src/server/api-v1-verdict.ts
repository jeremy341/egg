import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { deploymentIdInput, endpoint, NOT_FOUND_NOTE, projectIdInput, type Endpoint } from "@/server/api-v1-kit";
import { analyticsSummary } from "@/server/analytics";
import { errorGroups } from "@/server/error-groups";
import { deploymentView, projectRightSize, usageHistory } from "@/server/queries";
import { getProjectForUser } from "@/server/projects";

const daysInput = z.coerce.number().int().min(1).max(90).default(30);
const pressureInput = z.coerce.number().min(0.5).max(1).default(0.8);

export async function apiGetDeployVerdict(p: Principal, deploymentId: string) {
  requireScope(p, "deployments:read");
  const result = await deploymentView(p.userId, deploymentId);
  const { deployment, postDeployCheck } = result;
  let verdict: "pass" | "warning" | "failed" | "pending" | "inconclusive";

  if (deployment.state === "error") verdict = "failed";
  else if (["queued", "building", "deploying"].includes(deployment.state)) verdict = "pending";
  else if (deployment.state !== "ready") verdict = "inconclusive";
  else if (postDeployCheck?.verdict === "regressed") verdict = "warning";
  else if (postDeployCheck?.verdict === "ok") verdict = "pass";
  else verdict = "inconclusive";

  return {
    deploymentId,
    projectId: deployment.projectId,
    state: deployment.state,
    verdict,
    postDeployCheck,
    postDeployWaiting: result.postDeployWaiting,
    source: "deployment-state-and-post-deploy-health-checks" as const,
  };
}

export async function apiGetDeploymentHttpMetrics(p: Principal, deploymentId: string, days: number) {
  requireScope(p, "analytics:read");
  const { deployment } = await deploymentView(p.userId, deploymentId);
  const analytics = await analyticsSummary(p.userId, deployment.projectId, days);
  return {
    deploymentId,
    projectId: deployment.projectId,
    days: analytics.days,
    source: "pageview-analytics" as const,
    requests: analytics.views,
    daily: analytics.daily.map(({ day, views }) => ({ day, requests: views })),
    requestSemantics: "Counted pageviews only; non-pageview HTTP traffic is not collected.",
    statusCodesAvailable: false as const,
    latencyAvailable: false as const,
  };
}

export async function apiGetRequestStats(p: Principal, projectId: string, days: number) {
  requireScope(p, "analytics:read");
  const analytics = await analyticsSummary(p.userId, projectId, days);
  return {
    projectId,
    days: analytics.days,
    source: "pageview-analytics" as const,
    requests: analytics.views,
    visitors: analytics.visitors,
    daily: analytics.daily.map(({ day, views, visitors }) => ({ day, requests: views, visitors })),
    pages: analytics.pages,
    referrers: analytics.referrers,
    requestSemantics: "Counted pageviews only; this is not a web-server request log.",
  };
}

export async function apiGetAnomalies(p: Principal, projectId: string, days: number, threshold: number) {
  requireScope(p, "analytics:read");
  const project = await getProjectForUser(p.userId, projectId);
  const [groups, samples] = await Promise.all([
    errorGroups(p.userId, projectId, days),
    usageHistory(p.userId, project.serverId, days * 24),
  ]);
  const since = Date.now() - days * 86_400_000;
  const anomalies: {
    type: "client_error" | "resource_pressure";
    at: string;
    fingerprint?: string;
    message?: string;
    count?: number;
    metric?: "cpu" | "memory" | "disk";
    value?: number;
  }[] = groups
    .filter((group) => group.status === "open" && group.lastSeen >= since)
    .map((group) => ({
      type: "client_error",
      at: new Date(group.lastSeen).toISOString(),
      fingerprint: group.fingerprint,
      message: group.message,
      count: group.count,
    }));

  for (const sample of samples) {
    if (sample.at < since) continue;
    for (const [metric, value] of [["cpu", sample.cpu], ["memory", sample.mem], ["disk", sample.disk]] as const) {
      if (value !== null && value >= threshold) {
        anomalies.push({ type: "resource_pressure", at: new Date(sample.at).toISOString(), metric, value });
      }
    }
  }

  return { projectId, days, threshold, source: "client-errors-and-monitor-samples" as const, anomalies };
}

export async function apiGetResourceRecommendation(p: Principal, projectId: string) {
  requireScope(p, "resources:read");
  return {
    projectId,
    source: "monitor-resource-samples" as const,
    recommendation: await projectRightSize(p.userId, projectId),
  };
}

export async function apiGetAttackSignals(p: Principal, projectId: string, days: number) {
  requireScope(p, "analytics:read");
  const groups = await errorGroups(p.userId, projectId, days);
  const signals = groups
    .filter((group) => group.status === "open" && group.count >= 3)
    .map((group) => ({
      type: "client_error_burst" as const,
      fingerprint: group.fingerprint,
      message: group.message,
      count: group.count,
      firstSeen: new Date(group.firstSeen).toISOString(),
      lastSeen: new Date(group.lastSeen).toISOString(),
      interpretation: "Repeated client-side errors; not evidence of an attack.",
    }));
  return { projectId, days, source: "client-error-groups" as const, securityTelemetryAvailable: false as const, signals };
}

const endpoints: Endpoint[] = [
  endpoint({
    id: "get_deploy_verdict",
    method: "GET",
    path: "/deployments/{deploymentId}/verdict",
    scope: "deployments:read",
    bucket: "read",
    tag: "Deployments",
    summary: "Get a deployment health verdict",
    description:
      "Summarize deployment state and the stored post-deploy health comparison. A ready deployment without a completed comparison is inconclusive, not automatically healthy. " +
      NOT_FOUND_NOTE,
    pathParams: { deploymentId: deploymentIdInput },
    response: z.object({
      deploymentId: z.string(),
      projectId: z.string(),
      state: z.string(),
      verdict: z.enum(["pass", "warning", "failed", "pending", "inconclusive"]),
      postDeployCheck: z.unknown().nullable(),
      postDeployWaiting: z.boolean(),
      source: z.literal("deployment-state-and-post-deploy-health-checks"),
    }),
    errors: [404],
    run: (p, input) => apiGetDeployVerdict(p, input.deploymentId),
  }),
  endpoint({
    id: "get_deployment_http_metrics",
    method: "GET",
    path: "/deployments/{deploymentId}/http-metrics",
    scope: "analytics:read",
    bucket: "read",
    tag: "Analytics",
    summary: "Get pageview-based HTTP metrics",
    description:
      "Return pageviews as request-volume metrics for the deployment's project. Server HTTP access logs, status codes and request latency are not collected, so these metrics are not deployment-specific.",
    pathParams: { deploymentId: deploymentIdInput },
    query: { days: daysInput.describe("Look-back window, 1 to 90 days; defaults to 30.") },
    response: z.object({
      deploymentId: z.string(),
      projectId: z.string(),
      days: z.number().int(),
      source: z.literal("pageview-analytics"),
      requests: z.number().int(),
      daily: z.array(z.object({ day: z.string(), requests: z.number().int() })),
      requestSemantics: z.string(),
      statusCodesAvailable: z.literal(false),
      latencyAvailable: z.literal(false),
    }),
    errors: [404],
    run: (p, input) => apiGetDeploymentHttpMetrics(p, input.deploymentId, input.days),
  }),
  endpoint({
    id: "get_request_stats",
    method: "GET",
    path: "/projects/{projectId}/request-stats",
    scope: "analytics:read",
    bucket: "read",
    tag: "Analytics",
    summary: "Get pageview request statistics",
    description:
      "Summarize recorded pageviews, visitors, top pages and referrers. Pageviews are not all HTTP requests. " + NOT_FOUND_NOTE,
    pathParams: { projectId: projectIdInput },
    query: { days: daysInput.describe("Look-back window, 1 to 90 days; defaults to 30.") },
    response: z.object({
      projectId: z.string(),
      days: z.number().int(),
      source: z.literal("pageview-analytics"),
      requests: z.number().int(),
      visitors: z.number().int(),
      daily: z.array(z.object({ day: z.string(), requests: z.number().int(), visitors: z.number().int() })),
      pages: z.array(z.object({ path: z.string(), views: z.number().int() })),
      referrers: z.array(z.object({ host: z.string(), views: z.number().int() })),
      requestSemantics: z.string(),
    }),
    errors: [404],
    run: (p, input) => apiGetRequestStats(p, input.projectId, input.days),
  }),
  endpoint({
    id: "get_anomalies",
    method: "GET",
    path: "/projects/{projectId}/anomalies",
    scope: "analytics:read",
    bucket: "read",
    tag: "Analytics",
    summary: "Find client-error and resource anomalies",
    description:
      "List open client-error groups and monitor samples at or above a resource-pressure threshold. These observations are not causal diagnoses. " +
      NOT_FOUND_NOTE,
    pathParams: { projectId: projectIdInput },
    query: { days: daysInput, threshold: pressureInput },
    response: z.object({
      projectId: z.string(),
      days: z.number().int(),
      threshold: z.number(),
      source: z.literal("client-errors-and-monitor-samples"),
      anomalies: z.array(
        z.object({
          type: z.enum(["client_error", "resource_pressure"]),
          at: z.string(),
          fingerprint: z.string().optional(),
          message: z.string().optional(),
          count: z.number().optional(),
          metric: z.enum(["cpu", "memory", "disk"]).optional(),
          value: z.number().optional(),
        })
      ),
    }),
    errors: [404],
    run: (p, input) => apiGetAnomalies(p, input.projectId, input.days, input.threshold),
  }),
  endpoint({
    id: "get_resource_recommendation",
    method: "GET",
    path: "/projects/{projectId}/resource-recommendation",
    scope: "resources:read",
    bucket: "read",
    tag: "Resources",
    summary: "Get a monitor-backed resource recommendation",
    description:
      "Return a recommendation based on measured resource samples, or explain when there is insufficient monitor history. Nothing is applied. " +
      NOT_FOUND_NOTE,
    pathParams: { projectId: projectIdInput },
    response: z.object({ projectId: z.string(), source: z.literal("monitor-resource-samples"), recommendation: z.unknown() }),
    errors: [404],
    run: (p, input) => apiGetResourceRecommendation(p, input.projectId),
  }),
  endpoint({
    id: "get_attack_signals",
    method: "GET",
    path: "/projects/{projectId}/attack-signals",
    scope: "analytics:read",
    bucket: "read",
    tag: "Analytics",
    summary: "Review possible client-error bursts",
    description:
      "Surface repeated client-side error groups as investigation leads. Security or request-abuse telemetry is not available, so these signals do not establish that an attack occurred. " +
      NOT_FOUND_NOTE,
    pathParams: { projectId: projectIdInput },
    query: { days: daysInput.describe("Look-back window, 1 to 90 days; defaults to 30.") },
    response: z.object({
      projectId: z.string(),
      days: z.number().int(),
      source: z.literal("client-error-groups"),
      securityTelemetryAvailable: z.literal(false),
      signals: z.array(
        z.object({
          type: z.literal("client_error_burst"),
          fingerprint: z.string(),
          message: z.string(),
          count: z.number().int(),
          firstSeen: z.string(),
          lastSeen: z.string(),
          interpretation: z.string(),
        })
      ),
    }),
    errors: [404],
    run: (p, input) => apiGetAttackSignals(p, input.projectId, input.days),
  }),
];

export const VERDICT_ENDPOINTS: Endpoint[] = endpoints;

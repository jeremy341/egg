import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { tagAudit } from "@/server/api-v1-audit";
import { endpoint, projectIdInput, type Endpoint } from "@/server/api-v1-kit";
import { HttpError, notFound } from "@/server/http";
import { hookStatus } from "@/server/hooks";
import { deleteEnvVar, envInput, getProjectForUser, listEnvVars, mergeEnvVars, replaceEnvVars } from "@/server/projects";
import {
  createJob,
  deleteJob as deleteScheduledJob,
  fetchJobLogs,
  fetchJobStatuses,
  jobInput,
  jobPatch,
  listJobs,
  runJob,
  updateJob,
  type JobStatus,
  type JobView,
} from "@/server/scheduled-jobs";
import {
  createWebhook,
  createWebhookInput,
  EVENTS,
  getWebhook,
  listWebhooks,
  sendTestWebhook,
  updateWebhook,
  type WebhookEventName,
} from "@/server/webhooks";

const projectId = projectIdInput;
const jobId = z.string().trim().min(1).max(100).describe("The scheduled job id.");
const webhookId = z.string().trim().min(1).max(100).describe("The webhook channel id.");
const confirmName = z.string().min(1).max(100).describe("The exact resource name to confirm this action.");
const envTarget = envInput.shape.target;
const envEntrySchema = z.object({
  key: envInput.shape.key,
  target: z.enum(["all", "production", "preview"]),
});
const envValueSchema = z.object({
  key: envInput.shape.key,
  value: envInput.shape.value,
  target: envTarget,
});
const envValues = z.array(envValueSchema).max(100).superRefine((entries, ctx) => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const key = entry.key + "\u0000" + entry.target;
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: [index, "key"], message: "Each key and target may appear once." });
    seen.add(key);
  });
});
const envKeys = z.array(envInput.shape.key).min(1).max(100).superRefine((keys, ctx) => {
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Each key may appear once." });
});
const eventName = z.enum(EVENTS);
const eventList = z.array(eventName).min(1).max(EVENTS.length);
const webhookSchema = z.object({
  id: z.string(),
  url: z.string(),
  host: z.string(),
  projectId: z.string().nullable(),
  events: z.array(eventName),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  secretRotatedAt: z.string().nullable(),
});
const jobSchema = z.object({
  id: z.string(),
  name: z.string(),
  schedule: z.string(),
  description: z.string(),
  command: z.string(),
  enabled: z.boolean(),
  nextRunAt: z.string().nullable(),
  timeoutSeconds: z.number().int(),
});
const jobStatusSchema = z.object({
  id: z.string(),
  state: z.enum(["running", "failed", "ok", "never", "missing"]),
  exitCode: z.number().int().nullable(),
  lastEndedAt: z.string().nullable(),
  armed: z.boolean(),
});
const jobPatchFields = jobPatch.shape;
const webhookCreateFields = {
  url: createWebhookInput.shape.url,
  projectId: createWebhookInput.shape.projectId,
  events: createWebhookInput.shape.events,
};

function requireExactName(confirmation: string, expected: string, resource: string) {
  if (confirmation !== expected) {
    throw new HttpError(400, "Confirmation must exactly match the " + resource + " name.", "confirmation_failed");
  }
}

async function projectWithConfirmation(userId: string, id: string, confirmation: string) {
  const project = await getProjectForUser(userId, id);
  requireExactName(confirmation, project.name, "project");
  return project;
}

async function findJob(userId: string, projectIdValue: string, jobIdValue: string): Promise<JobView> {
  const job = (await listJobs(userId, projectIdValue)).find((item) => item.id === jobIdValue);
  if (!job) throw notFound("Scheduled job not found");
  return job;
}

export async function apiAddEnvVars(
  p: Principal,
  projectIdValue: string,
  entries: z.output<typeof envValues>
) {
  requireScope(p, "env:write");
  const env = await tagAudit(
    p,
    "env.set",
    () => mergeEnvVars(p.userId, projectIdValue, entries),
    { count: entries.length }
  );
  return { env };
}

export async function apiReplaceEnvVars(
  p: Principal,
  projectIdValue: string,
  confirmation: string,
  entries: z.output<typeof envValues>
) {
  requireScope(p, "env:write");
  const project = await projectWithConfirmation(p.userId, projectIdValue, confirmation);
  const removed = await tagAudit(
    p,
    "env.replace",
    () => replaceEnvVars(p.userId, project.id, entries),
    { count: entries.length }
  );
  return {
    env: entries.map(({ key, target }) => ({ key, target })),
    deleted: removed,
  };
}

export async function apiDeleteEnvVars(
  p: Principal,
  projectIdValue: string,
  confirmation: string,
  keys: string[],
  target?: "all" | "production" | "preview"
) {
  requireScope(p, "env:write");
  const project = await projectWithConfirmation(p.userId, projectIdValue, confirmation);
  const existing = await listEnvVars(p.userId, project.id);
  const removed = existing.filter((entry) => keys.includes(entry.key) && (target === undefined || entry.target === target));
  for (const key of keys) {
    if (!removed.some((entry) => entry.key === key)) throw notFound("Environment variable not found");
  }
  await tagAudit(
    p,
    "env.delete",
    async () => {
      for (const entry of removed) await deleteEnvVar(p.userId, project.id, entry.id);
    },
    { names: keys.join(", "), target: target ?? "all" }
  );
  return { deleted: removed.map(({ key, target: deletedTarget }) => ({ key, target: deletedTarget })) };
}

export async function apiListDeployWebhookTokens(p: Principal, projectIdValue: string) {
  requireScope(p, "deployments:read");
  const status = await hookStatus(p.userId, projectIdValue);
  // Egg has one hook per project and stores no token id or recoverable token.
  return {
    tokens: status.active
      ? [{ active: true, createdAt: status.createdAt?.toISOString() ?? null }]
      : [],
  };
}

export async function apiListJobs(p: Principal, projectIdValue: string) {
  requireScope(p, "jobs:read");
  return { jobs: await listJobs(p.userId, projectIdValue) };
}

export async function apiGetJob(p: Principal, projectIdValue: string, jobIdValue: string) {
  requireScope(p, "jobs:read");
  return { job: await findJob(p.userId, projectIdValue, jobIdValue) };
}

export async function apiCreateJob(
  p: Principal,
  projectIdValue: string,
  input: z.output<typeof jobInput>
) {
  requireScope(p, "jobs:write");
  const job = await tagAudit(
    p,
    "job.create",
    () => createJob(p.userId, projectIdValue, input),
    { name: input.name }
  );
  return { job };
}

export async function apiUpdateJob(
  p: Principal,
  projectIdValue: string,
  jobIdValue: string,
  changes: Record<string, unknown>
) {
  requireScope(p, "jobs:write");
  if (Object.keys(changes).length === 0) throw new HttpError(400, "Send at least one job field to change.", "validation");
  const job = await tagAudit(
    p,
    "job.update",
    () => updateJob(p.userId, projectIdValue, jobIdValue, changes),
    { fields: Object.keys(changes).join(", ") }
  );
  return { job };
}

export async function apiRunJob(
  p: Principal,
  projectIdValue: string,
  jobIdValue: string,
  confirmation: string
) {
  requireScope(p, "jobs:write");
  const job = await findJob(p.userId, projectIdValue, jobIdValue);
  await tagAudit(p, "job.run", () => runJob(p.userId, projectIdValue, jobIdValue, confirmation), { name: job.name });
  return { jobId: jobIdValue, started: true };
}

export async function apiListJobRuns(p: Principal, projectIdValue: string, jobIdValue: string) {
  requireScope(p, "jobs:read");
  await findJob(p.userId, projectIdValue, jobIdValue);
  const status = (await fetchJobStatuses(p.userId, projectIdValue)).find((entry) => entry.id === jobIdValue);
  if (!status) throw notFound("Scheduled job not found");
  // Egg stores only the current/latest systemd status, not a run history or run ids.
  const runs: JobStatus[] = status.state === "never" || status.state === "missing" ? [] : [status];
  return { jobId: jobIdValue, runs };
}

export async function apiGetJobRunLogs(p: Principal, projectIdValue: string, jobIdValue: string) {
  requireScope(p, "jobs:read");
  await findJob(p.userId, projectIdValue, jobIdValue);
  return { jobId: jobIdValue, lines: await fetchJobLogs(p.userId, projectIdValue, jobIdValue) };
}

export async function apiDeleteJob(
  p: Principal,
  projectIdValue: string,
  jobIdValue: string,
  confirmation: string
) {
  requireScope(p, "jobs:write");
  const job = await findJob(p.userId, projectIdValue, jobIdValue);
  await tagAudit(p, "job.delete", () => deleteScheduledJob(p.userId, projectIdValue, jobIdValue, confirmation), { name: job.name });
  return { deleted: true, jobId: jobIdValue };
}

export async function apiListNotificationChannels(p: Principal) {
  requireScope(p, "webhooks:read");
  return { webhooks: await listWebhooks(p.userId) };
}

export async function apiCreateNotificationChannel(
  p: Principal,
  input: z.output<typeof createWebhookInput>
) {
  requireScope(p, "webhooks:write");
  return tagAudit(
    p,
    "webhook.create",
    () => createWebhook(p.userId, input),
    { projectId: input.projectId ?? "all" }
  );
}

export async function apiListNotificationRules(p: Principal) {
  requireScope(p, "webhooks:read");
  const webhooks = await listWebhooks(p.userId);
  return {
    rules: webhooks.map((webhook) => ({
      webhookId: webhook.id,
      projectId: webhook.projectId,
      events: webhook.events,
    })),
  };
}

export async function apiCreateNotificationRule(
  p: Principal,
  webhookIdValue: string,
  events: WebhookEventName[]
) {
  requireScope(p, "webhooks:write");
  const current = await getWebhook(p.userId, webhookIdValue);
  const combined = [...new Set([...current.events, ...events])];
  const webhook = await tagAudit(
    p,
    "webhook.update",
    () => updateWebhook(p.userId, webhookIdValue, { events: combined }),
    { fields: "events" }
  );
  return {
    rule: {
      webhookId: webhook.id,
      projectId: webhook.projectId,
      events: webhook.events,
    },
  };
}

export async function apiTestNotificationChannel(p: Principal, webhookIdValue: string) {
  requireScope(p, "webhooks:write");
  const delivery = await tagAudit(
    p,
    "webhook.test",
    () => sendTestWebhook(p.userId, webhookIdValue),
    { channel: webhookIdValue }
  );
  return { delivery };
}

const webhookRuleSchema = z.object({
  webhookId: z.string(),
  projectId: z.string().nullable(),
  events: z.array(eventName),
});
const notificationRulesSchema = z.object({ rules: z.array(webhookRuleSchema) });

export const ORCHARD_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "add_env_vars",
    method: "POST",
    path: "/projects/{projectId}/env",
    scope: "env:write",
    bucket: "write",
    sensitive: true,
    tag: "Environment",
    summary: "Merge environment variables",
    description: "Add or replace the supplied project variables while leaving other names and targets unchanged. Values are encrypted at rest, write-only and never returned. Each variable reaches the app on the next deploy.",
    pathParams: { projectId },
    body: { envVars: envValues },
    response: z.object({ env: z.array(envEntrySchema) }),
    errors: [400, 404],
    maxBodyBytes: 1_048_576,
    run: (p, i) => apiAddEnvVars(p, i.projectId, i.envVars),
  }),
  endpoint({
    id: "set_env_vars",
    method: "PUT",
    path: "/projects/{projectId}/env",
    scope: "env:write",
    bucket: "write",
    sensitive: true,
    tag: "Environment",
    summary: "Replace all environment variables",
    description: "Replace every variable and target on the project with the supplied list. Omitted names are deleted. Egg keeps all values write-only, so existing secret values cannot be read or round-tripped. Requires confirmName to exactly match the project name.",
    pathParams: { projectId },
    body: { envVars: envValues, confirmName },
    response: z.object({ env: z.array(envEntrySchema), deleted: z.array(envEntrySchema) }),
    errors: [400, 404],
    destructive: true,
    maxBodyBytes: 1_048_576,
    run: (p, i) => apiReplaceEnvVars(p, i.projectId, i.confirmName, i.envVars),
  }),
  endpoint({
    id: "delete_env_vars",
    method: "DELETE",
    path: "/projects/{projectId}/env",
    scope: "env:write",
    bucket: "write",
    sensitive: true,
    tag: "Environment",
    summary: "Delete environment variables",
    description: "Remove every target for the named keys, or only the selected target. Requires confirmName to exactly match the project name. Values are never returned.",
    pathParams: { projectId },
    body: {
      keys: envKeys,
      confirmName,
      target: envTarget.removeDefault().optional(),
    },
    response: z.object({ deleted: z.array(envEntrySchema) }),
    errors: [400, 404],
    destructive: true,
    run: (p, i) => apiDeleteEnvVars(p, i.projectId, i.confirmName, i.keys, i.target),
  }),
  endpoint({
    id: "list_deploy_webhook_tokens",
    method: "GET",
    path: "/projects/{projectId}/hook",
    scope: "deployments:read",
    bucket: "read",
    tag: "Deployments",
    summary: "List deploy webhook token status",
    description: "Egg has one deploy hook per project. This returns whether it is active and when it was created; it never returns the token or URL. The hook has no listable token id, so this is a partial match for token inventory.",
    pathParams: { projectId },
    response: z.object({
      tokens: z.array(z.object({ active: z.boolean(), createdAt: z.string().nullable() })),
    }),
    errors: [400, 404],
    run: (p, i) => apiListDeployWebhookTokens(p, i.projectId),
  }),
  endpoint({
    id: "list_jobs",
    method: "GET",
    path: "/projects/{projectId}/jobs",
    scope: "jobs:read",
    bucket: "read",
    tag: "Deployments",
    summary: "List scheduled jobs",
    description: "List this project's scheduled command jobs and their cron definitions. Times are interpreted in UTC. Egg runs these jobs through systemd on the project's server.",
    pathParams: { projectId },
    response: z.object({ jobs: z.array(jobSchema) }),
    errors: [400, 404],
    run: (p, i) => apiListJobs(p, i.projectId),
  }),
  endpoint({
    id: "get_job",
    method: "GET",
    path: "/projects/{projectId}/jobs/{jobId}",
    scope: "jobs:read",
    bucket: "read",
    tag: "Deployments",
    summary: "Get a scheduled job",
    description: "Read one scheduled job definition. This app stores a single command and schedule rather than Orchard's ordered pipeline steps.",
    pathParams: { projectId, jobId },
    response: z.object({ job: jobSchema }),
    errors: [400, 404],
    run: (p, i) => apiGetJob(p, i.projectId, i.jobId),
  }),
  endpoint({
    id: "create_job",
    method: "POST",
    path: "/projects/{projectId}/jobs",
    scope: "jobs:write",
    bucket: "ssh",
    status: 201,
    tag: "Deployments",
    summary: "Create a scheduled job",
    description: "Create one scheduled command for a deployed project. The command runs on the owner's server and is a single line; the schedule uses five-field cron in UTC.",
    pathParams: { projectId },
    body: jobInput.shape,
    response: z.object({ job: jobSchema }),
    errors: [400, 404, 409, 502],
    run: (p, i) => apiCreateJob(p, i.projectId, i),
  }),
  endpoint({
    id: "update_job",
    method: "PATCH",
    path: "/projects/{projectId}/jobs/{jobId}",
    scope: "jobs:write",
    bucket: "ssh",
    tag: "Deployments",
    summary: "Update or pause a scheduled job",
    description: "Change a job's name, schedule, command or enabled state. Set enabled to false to pause it and true to resume it. The app stores one command, not ordered steps.",
    pathParams: { projectId, jobId },
    body: jobPatchFields,
    response: z.object({ job: jobSchema }),
    errors: [400, 404, 409, 502],
    run: (p, i) => {
      const { projectId: project, jobId: id, ...changes } = i;
      return apiUpdateJob(p, project, id, changes);
    },
  }),
  endpoint({
    id: "run_job",
    method: "POST",
    path: "/projects/{projectId}/jobs/{jobId}/run",
    scope: "jobs:write",
    bucket: "ssh",
    tag: "Deployments",
    summary: "Run a scheduled job now",
    description: "Start the saved command on the project server now. Because this executes the user's command, confirmName must exactly match the job name.",
    pathParams: { projectId, jobId },
    body: { confirmName },
    response: z.object({ jobId: z.string(), started: z.boolean() }),
    errors: [400, 404, 409, 502],
    destructive: true,
    run: (p, i) => apiRunJob(p, i.projectId, i.jobId, i.confirmName),
  }),
  endpoint({
    id: "list_job_runs",
    method: "GET",
    path: "/projects/{projectId}/jobs/{jobId}/runs",
    scope: "jobs:read",
    bucket: "ssh",
    tag: "Deployments",
    summary: "Read the latest scheduled-job status",
    description: "Egg does not retain run history or run ids. This returns at most one live/latest systemd status snapshot, so it is a partial match for listing historical runs.",
    pathParams: { projectId, jobId },
    response: z.object({ jobId: z.string(), runs: z.array(jobStatusSchema) }),
    errors: [400, 404, 502],
    run: (p, i) => apiListJobRuns(p, i.projectId, i.jobId),
  }),
  endpoint({
    id: "get_job_run_logs",
    method: "GET",
    path: "/projects/{projectId}/jobs/{jobId}/logs",
    scope: "jobs:read",
    bucket: "ssh",
    tag: "Logs",
    summary: "Read recent scheduled-job output",
    description: "Read up to 120 recent log lines for this job. Egg does not retain run ids, so these logs cannot be limited to a specific run.",
    pathParams: { projectId, jobId },
    response: z.object({ jobId: z.string(), lines: z.array(z.string()) }),
    errors: [400, 404, 502],
    untrusted: true,
    run: (p, i) => apiGetJobRunLogs(p, i.projectId, i.jobId),
  }),
  endpoint({
    id: "delete_job",
    method: "DELETE",
    path: "/projects/{projectId}/jobs/{jobId}",
    scope: "jobs:write",
    bucket: "ssh",
    tag: "Deployments",
    summary: "Delete a scheduled job",
    description: "Permanently remove the job and its systemd units. confirmName must exactly match the job name.",
    pathParams: { projectId, jobId },
    body: { confirmName },
    response: z.object({ deleted: z.boolean(), jobId: z.string() }),
    errors: [400, 404, 409, 502],
    destructive: true,
    run: (p, i) => apiDeleteJob(p, i.projectId, i.jobId, i.confirmName),
  }),
  endpoint({
    id: "list_notification_channels",
    method: "GET",
    path: "/webhooks",
    scope: "webhooks:read",
    bucket: "read",
    tag: "Notifications",
    summary: "List outbound notification channels",
    description: "List the owner's generic HTTPS webhook channels and their deployment event filters. Egg has no Discord, Slack or email channel types in this API.",
    response: z.object({ webhooks: z.array(webhookSchema) }),
    errors: [400],
    run: (p) => apiListNotificationChannels(p),
  }),
  endpoint({
    id: "create_notification_channel",
    method: "POST",
    path: "/webhooks",
    scope: "webhooks:write",
    bucket: "write",
    sensitive: true,
    status: 201,
    untrusted: false,
    tag: "Notifications",
    summary: "Create an outbound notification channel",
    description: "Create a generic HTTPS webhook channel for deployment events. Its signing secret is returned once and never replayed from idempotency storage. Egg has no separate channel name, Discord/Slack/email adapter, or per-organization scope.",
    body: webhookCreateFields,
    response: z.object({ webhook: webhookSchema, secret: z.string().describe("One-time webhook signing secret.") }),
    errors: [400, 404, 409],
    run: (p, i) => apiCreateNotificationChannel(p, i),
  }),
  endpoint({
    id: "list_notification_rules",
    method: "GET",
    path: "/webhooks/rules",
    scope: "webhooks:read",
    bucket: "read",
    tag: "Notifications",
    summary: "List webhook event filters",
    description: "List each outbound webhook's deployment event filter as a rule. Egg stores the event list on the channel itself and does not support separate scopes, mute rules, or rule ids.",
    response: notificationRulesSchema,
    errors: [400],
    run: (p) => apiListNotificationRules(p),
  }),
  endpoint({
    id: "create_notification_rule",
    method: "POST",
    path: "/webhooks/{webhookId}/rules",
    scope: "webhooks:write",
    bucket: "write",
    tag: "Notifications",
    summary: "Add deployment events to a webhook filter",
    description: "Add event names to an existing webhook's event filter. This merges into its current event list; Egg has no standalone notification-rule record or mute mode.",
    pathParams: { webhookId },
    body: { events: eventList },
    response: z.object({ rule: webhookRuleSchema }),
    errors: [400, 404],
    run: (p, i) => apiCreateNotificationRule(p, i.webhookId, i.events),
  }),
  endpoint({
    id: "test_notification_channel",
    method: "POST",
    path: "/webhooks/{webhookId}/test",
    scope: "webhooks:write",
    bucket: "ssh",
    tag: "Notifications",
    summary: "Send a test notification",
    description: "Send a signed sample deployment event to an outbound webhook and report delivery status. The request uses the owner's webhook scope and small test-send rate limit.",
    pathParams: { webhookId },
    response: z.object({
      delivery: z.object({
        id: z.string(),
        webhookId: z.string(),
        event: z.string(),
        deploymentId: z.string().nullable(),
        status: z.enum(["pending", "success", "failed"]),
        attempts: z.number().int(),
        lastErrorCode: z.string().nullable(),
        createdAt: z.string(),
        finishedAt: z.string().nullable(),
      }),
    }),
    errors: [400, 404, 502],
    untrusted: true,
    run: (p, i) => apiTestNotificationChannel(p, i.webhookId),
  }),
];

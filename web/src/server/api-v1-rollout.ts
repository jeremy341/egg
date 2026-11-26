import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { endpoint, deploymentIdInput, NOT_FOUND_NOTE, type Endpoint } from "@/server/api-v1-kit";
import { deploymentSchema, requireView, toDeployment } from "@/server/api-v1-models";
import { projectIdInput } from "@/server/api-v1-kit";
import { enforceRateLimit } from "@/server/rate-limit";
import { restartService } from "@/server/runtime-info";
import { forgetServiceStatus } from "@/server/service-status";

/**
 * Rollout state for agents: one GET that can wait for a deploy or rollback to
 * finish, so an agent does not have to poll list_deployments itself. Rolling back
 * is already `rollback_deployment` in api-v1.ts; this file adds the way to watch it.
 */

/** The longest one call will hold the connection open. */
export const ROLLOUT_MAX_WAIT_MS = 60_000;
/** How often the state is read while waiting. */
export const ROLLOUT_POLL_MS = 2_000;

/** States after which nothing more will happen to the deployment. */
export const ROLLOUT_FINISHED = ["ready", "error", "canceled"] as const;

export type RolloutOptions = {
  waitMs?: number;
  pollMs?: number;
  /** Injected so tests can run the clock without real waiting. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type RolloutState = {
  deployment: ReturnType<typeof toDeployment>;
  /** True once the deployment reached ready, error or canceled. */
  done: boolean;
  /** Milliseconds spent waiting. 0 when the call did not wait. */
  waitedMs: number;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The rollout of one deployment, read now. With `wait`, it keeps reading every
 * `pollMs` until the deployment finishes or `waitMs` has passed, and then returns
 * whatever state it is in. Waiting never gives up with an error.
 */
export async function apiGetRollout(
  p: Principal,
  deploymentId: string,
  wait: boolean,
  opts: RolloutOptions = {}
): Promise<{ rollout: RolloutState }> {
  requireScope(p, "deployments:read");
  const waitMs = Math.min(Math.max(0, opts.waitMs ?? ROLLOUT_MAX_WAIT_MS), ROLLOUT_MAX_WAIT_MS);
  const pollMs = Math.max(1, opts.pollMs ?? ROLLOUT_POLL_MS);
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;

  const started = now();
  let view = toDeployment(await requireView(p, deploymentId));
  const finished = (s: string) => (ROLLOUT_FINISHED as readonly string[]).includes(s);
  while (wait && !finished(view.state)) {
    const elapsed = now() - started;
    if (elapsed >= waitMs) break;
    await sleep(Math.min(pollMs, waitMs - elapsed));
    view = toDeployment(await requireView(p, deploymentId));
  }
  return {
    rollout: {
      deployment: view,
      done: finished(view.state),
      waitedMs: wait ? Math.max(0, now() - started) : 0,
    },
  };
}

/**
 * Restart the production service of a project on its container. The same call the
 * dashboard makes, with the same owner check and the same per-user restart limit.
 */
export async function apiRestartService(p: Principal, projectId: string) {
  requireScope(p, "deployments:write");
  enforceRateLimit("sshSession", p.userId);
  enforceRateLimit("serviceRestart", p.userId);
  await restartService(p.userId, projectId);
  forgetServiceStatus(projectId);
  return { restarted: true, projectId };
}

const wait = z
  .union([z.boolean(), z.enum(["0", "1", "false", "true"])])
  .optional()
  .describe("Set to 1 to wait up to 60 seconds for the deployment to finish. Left out, the current state is returned at once.");

export const ROLLOUT_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "get_rollout",
    method: "GET",
    path: "/deployments/{deploymentId}/rollout",
    scope: "deployments:read",
    bucket: "read",
    tag: "Deployments",
    summary: "Watch a rollout, optionally waiting for it to finish",
    description: `Read the state of one deployment, such as the rollback or deploy you just started. With wait=1 the call holds for up to 60 seconds, reading the state every few seconds, and stops early once it is ready, error or canceled. The answer says whether it is done and how long it waited; if it is not done, call again. A rollback is live when its deployment shows isCurrent true. ${NOT_FOUND_NOTE}`,
    pathParams: { deploymentId: deploymentIdInput },
    query: { wait },
    response: z.object({
      rollout: z.object({
        deployment: deploymentSchema,
        done: z.boolean().describe("True once the deployment is ready, error or canceled."),
        waitedMs: z.number().int().describe("How long this call waited, in milliseconds. 0 without wait=1."),
      }),
    }),
    errors: [400, 404],
    untrusted: true,
    run: (p, i) => apiGetRollout(p, i.deploymentId, i.wait === true || i.wait === "1" || i.wait === "true"),
  }),
  endpoint({
    id: "restart_service",
    method: "POST",
    path: "/projects/{projectId}/restart",
    scope: "deployments:write",
    // Writes go in the write bucket; the restart itself is also limited (sshSession, serviceRestart) as on the dashboard.
    bucket: "write",
    tag: "Deployments",
    summary: "Restart the production service",
    description: `Restart the project's production service on its container, the same as the dashboard's Restart button. Visitors may see a brief gap. Needs owner access to the project. Returns 502 if the container could not restart it, for example because it is not deployed yet. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId: projectIdInput },
    response: z.object({ restarted: z.boolean(), projectId: z.string() }),
    errors: [400, 404, 502],
    run: (p, i) => apiRestartService(p, i.projectId),
  }),
];

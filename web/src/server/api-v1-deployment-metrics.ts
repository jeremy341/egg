import { asc, and, desc, eq, gte, lt, lte } from "drizzle-orm";
import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { deploymentIdInput, endpoint, NOT_FOUND_NOTE, type Endpoint } from "@/server/api-v1-kit";
import { requireView } from "@/server/api-v1-models";
import { getDb, schema } from "@/server/db";

const windowHoursInput = z.coerce.number().int().min(1).max(168).default(24)
  .describe("How many recent hours to include, 1 to 168. Default 24.");
const bucketMinutesInput = z.coerce.number().int().min(5).max(1440).default(60)
  .describe("How many minutes to group samples into, 5 to 1440. Default 60.");

type MetricBucket = {
  at: number;
  cpuTotal: number;
  cpuCount: number;
  memoryTotal: number;
  memoryCount: number;
  restarts: number;
};

export async function apiGetDeploymentMetrics(
  p: Principal,
  deploymentId: string,
  input: { window: number; bucket: number },
) {
  requireScope(p, "deployments:read");
  const deployment = await requireView(p, deploymentId);
  const now = Date.now();
  const since = new Date(now - input.window * 60 * 60 * 1000);
  const bucketMs = input.bucket * 60 * 1000;
  const db = await getDb();

  const previous = await db
    .select({ at: schema.projectSamples.at, restarts: schema.projectSamples.restarts })
    .from(schema.projectSamples)
    .where(and(eq(schema.projectSamples.projectId, deployment.projectId), lt(schema.projectSamples.at, since)))
    .orderBy(desc(schema.projectSamples.at))
    .limit(1)
    .get();
  const samples = await db
    .select({
      at: schema.projectSamples.at,
      cpuPercent: schema.projectSamples.cpuPercent,
      memMb: schema.projectSamples.memMb,
      restarts: schema.projectSamples.restarts,
    })
    .from(schema.projectSamples)
    .where(
      and(
        eq(schema.projectSamples.projectId, deployment.projectId),
        gte(schema.projectSamples.at, since),
        lte(schema.projectSamples.at, new Date(now)),
      ),
    )
    .orderBy(asc(schema.projectSamples.at));

  const buckets = new Map<number, MetricBucket>();
  let previousRestarts = previous?.restarts ?? null;
  for (const sample of samples) {
    const at = Math.floor(sample.at.getTime() / bucketMs) * bucketMs;
    let current = buckets.get(at);
    if (!current) {
      current = { at, cpuTotal: 0, cpuCount: 0, memoryTotal: 0, memoryCount: 0, restarts: 0 };
      buckets.set(at, current);
    }

    if (sample.cpuPercent !== null) {
      current.cpuTotal += sample.cpuPercent;
      current.cpuCount += 1;
    }
    if (sample.memMb !== null) {
      current.memoryTotal += sample.memMb;
      current.memoryCount += 1;
    }
    if (sample.restarts !== null) {
      if (previousRestarts !== null) current.restarts += Math.max(0, sample.restarts - previousRestarts);
      previousRestarts = sample.restarts;
    }
  }

  return {
    deploymentId,
    projectId: deployment.projectId,
    window: input.window,
    bucket: input.bucket,
    samples: [...buckets.values()].map((value) => ({
      at: new Date(value.at).toISOString(),
      cpuPercent: value.cpuCount === 0 ? null : value.cpuTotal / value.cpuCount,
      memoryMb: value.memoryCount === 0 ? null : value.memoryTotal / value.memoryCount,
      restarts: value.restarts,
    })),
  };
}

export const DEPLOYMENT_METRICS_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "get_deployment_metrics",
    method: "GET",
    path: "/deployments/{deploymentId}/metrics",
    scope: "deployments:read",
    bucket: "read",
    tag: "Deployments",
    summary: "Read deployment service metrics",
    description: `Read bucketed CPU, memory and restart counts from the project's service samples. Samples are tracked per project, so they are not attributed to this individual release. ${NOT_FOUND_NOTE}`,
    pathParams: { deploymentId: deploymentIdInput },
    query: { window: windowHoursInput, bucket: bucketMinutesInput },
    response: z.object({
      deploymentId: z.string(),
      projectId: z.string(),
      window: z.number().int(),
      bucket: z.number().int(),
      samples: z.array(z.object({
        at: z.string().datetime(),
        cpuPercent: z.number().nullable(),
        memoryMb: z.number().nullable(),
        restarts: z.number().int(),
      })),
    }),
    errors: [400, 404],
    run: (p, i) => apiGetDeploymentMetrics(p, i.deploymentId, { window: i.window, bucket: i.bucket }),
  }),
];

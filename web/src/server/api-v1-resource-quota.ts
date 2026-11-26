import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { endpoint, projectIdInput, type Endpoint, NOT_FOUND_NOTE } from "@/server/api-v1-kit";
import { getDb, schema } from "@/server/db";
import { dockerContainerName } from "@/server/deploy/remote";
import { serverDiscriminator, unitName } from "@/server/deploy/layout";
import { notFound } from "@/server/http";
import { getServerForUser, withServerSession } from "@/server/servers";
import { SshError, shellQuote } from "@/server/ssh/connection";

const MEBIBYTE = 1024 * 1024;

type Limits = { cpuLimitCores: number | null; memoryLimitMb: number | null };

function positiveNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

function memoryLimitMb(raw: string | undefined): number | null {
  const bytes = positiveNumber(raw);
  return bytes === null ? null : bytes / MEBIBYTE;
}

function systemdCpuCores(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = /^(\d+(?:\.\d+)?)(ns|us|µs|ms|s|min|h)$/.exec(raw.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const seconds = amount * ({ ns: 1e-9, us: 1e-6, "µs": 1e-6, ms: 1e-3, s: 1, min: 60, h: 3600 } as const)[match[2] as "ns" | "us" | "µs" | "ms" | "s" | "min" | "h"];
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function parseSystemdLimits(stdout: string): Limits {
  const values = new Map(
    stdout.split(/\r?\n/).flatMap((line) => {
      const separator = line.indexOf("=");
      return separator < 0 ? [] : [[line.slice(0, separator), line.slice(separator + 1)] as const];
    })
  );
  return {
    cpuLimitCores: systemdCpuCores(values.get("cpu")),
    memoryLimitMb: memoryLimitMb(values.get("memory")),
  };
}

function parseDockerLimits(stdout: string): Limits {
  const [memory, nanoCpus, cpuQuota, cpuPeriod] = stdout.trim().split("|");
  const nano = positiveNumber(nanoCpus);
  const quota = positiveNumber(cpuQuota);
  const period = positiveNumber(cpuPeriod);
  const cpuLimitCores = nano !== null ? nano / 1_000_000_000 : quota !== null && period !== null ? quota / period : null;
  return {
    cpuLimitCores: cpuLimitCores !== null && Number.isFinite(cpuLimitCores) && cpuLimitCores > 0 ? cpuLimitCores : null,
    memoryLimitMb: memoryLimitMb(memory),
  };
}

function limitsScript(project: typeof schema.projects.$inferSelect, serverId: string) {
  const scope = serverDiscriminator(serverId);
  if (project.deploymentMode === "native") {
    const unit = shellQuote(unitName(project.slug, undefined, scope));
    return (
      `cpu=$(systemctl show ${unit} --property=CPUQuotaPerSecUSec --value 2>/dev/null || true)\n` +
      `memory=$(systemctl show ${unit} --property=MemoryMax --value 2>/dev/null || true)\n` +
      `printf 'cpu=%s\\nmemory=%s\\n' "$cpu" "$memory"\n`
    );
  }
  const container = shellQuote(dockerContainerName(project.slug, undefined, scope));
  return `docker inspect --format '{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}|{{.HostConfig.CpuQuota}}|{{.HostConfig.CpuPeriod}}' ${container} 2>/dev/null || true\n`;
}

async function readLimits(project: typeof schema.projects.$inferSelect, serverId: string, server: Awaited<ReturnType<typeof getServerForUser>>): Promise<Limits> {
  try {
    const result = await withServerSession(server, (session) =>
      session.script(limitsScript(project, serverId), { timeoutMs: 15_000, maxOutputBytes: 1024 })
    );
    if (result.code !== 0) return { cpuLimitCores: null, memoryLimitMb: null };
    return project.deploymentMode === "native" ? parseSystemdLimits(result.stdout) : parseDockerLimits(result.stdout);
  } catch (error) {
    if (error instanceof SshError) return { cpuLimitCores: null, memoryLimitMb: null };
    throw error;
  }
}

export async function apiGetResourceQuota(p: Principal, projectId: string) {
  requireScope(p, "resources:read");
  const db = await getDb();
  const project = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, p.userId)))
    .get();
  if (!project) throw notFound("Project not found");

  const server = await getServerForUser(p.userId, project.serverId);
  const [projectSample, serverSample, serviceCount, limits] = await Promise.all([
    db
      .select({ memMb: schema.projectSamples.memMb, cpuPercent: schema.projectSamples.cpuPercent })
      .from(schema.projectSamples)
      .where(eq(schema.projectSamples.projectId, project.id))
      .orderBy(desc(schema.projectSamples.at))
      .limit(1)
      .get(),
    db
      .select({
        memUsedMb: schema.usageSamples.memUsedMb,
        memTotalMb: schema.usageSamples.memTotalMb,
        diskUsedMb: schema.usageSamples.diskUsedMb,
        diskTotalMb: schema.usageSamples.diskTotalMb,
      })
      .from(schema.usageSamples)
      .where(eq(schema.usageSamples.serverId, server.id))
      .orderBy(desc(schema.usageSamples.at))
      .limit(1)
      .get(),
    db
      .select({ value: count() })
      .from(schema.projects)
      .where(and(eq(schema.projects.serverId, server.id), eq(schema.projects.userId, p.userId)))
      .get(),
    readLimits(project, server.id, server),
  ]);

  return {
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      ...limits,
      cpuUsagePercent: projectSample?.cpuPercent ?? null,
      memoryUsageMb: projectSample?.memMb ?? null,
    },
    server: {
      serviceCount: serviceCount?.value ?? 0,
      memoryTotalMb: serverSample?.memTotalMb ?? null,
      memoryUsedMb: serverSample?.memUsedMb ?? null,
      diskTotalMb: serverSample?.diskTotalMb ?? null,
      diskUsedMb: serverSample?.diskUsedMb ?? null,
    },
  };
}

export const RESOURCE_QUOTA_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "get_resource_quota",
    method: "GET",
    path: "/projects/{projectId}/resources/quota",
    scope: "resources:read",
    bucket: "ssh",
    tag: "Resources",
    summary: "Read a project's resource limits and usage",
    description: `Read the CPU and memory limits for one project and its latest sampled CPU and memory usage, plus the server's latest memory and disk measurements and count of the owner's projects on that server. A value is null when Egg has no measurement or configured limit. Requires resources:read and counts against the small SSH rate limit. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId: projectIdInput },
    response: z.object({
      project: z.object({
        id: z.string(),
        slug: z.string(),
        name: z.string(),
        cpuLimitCores: z.number().nullable(),
        memoryLimitMb: z.number().nullable(),
        cpuUsagePercent: z.number().nullable(),
        memoryUsageMb: z.number().nullable(),
      }),
      server: z.object({
        serviceCount: z.number().int(),
        memoryTotalMb: z.number().nullable(),
        memoryUsedMb: z.number().nullable(),
        diskTotalMb: z.number().nullable(),
        diskUsedMb: z.number().nullable(),
      }),
    }),
    errors: [404],
    run: (p, i) => apiGetResourceQuota(p, i.projectId),
  }),
];

import { and, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http";
import {
  DEFAULT_CONTAINER_BUILD_MEMORY_MB,
  BUILD_CPU_STEP,
  buildCpuRange,
  buildMemoryRange,
  checkBuildCpu,
  checkBuildMemory,
  reportedCpus,
  reportedMemoryMb,
} from "@/lib/build-memory";

export type BuildMemorySetting = { memoryMb: number; minMb: number; maxMb: number; defaultMb: number };
export type BuildCpuSetting = { cpuCores: number; minCpus: number; maxCpus: number; defaultCpus: number; step: number };

async function ownedServer(userId: string, serverId: string) {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.servers)
    .where(and(eq(schema.servers.id, serverId), eq(schema.servers.userId, userId)))
    .get();
  if (!row) throw notFound("Server not found");
  return row;
}

function settingOf(row: { buildMemoryMb: number; probe: string | null }): BuildMemorySetting {
  const { min, max } = buildMemoryRange(reportedMemoryMb(row.probe));
  return { memoryMb: row.buildMemoryMb, minMb: min, maxMb: max, defaultMb: DEFAULT_CONTAINER_BUILD_MEMORY_MB };
}

function cpuSettingOf(row: { buildCpuQuarters: number; probe: string | null }): BuildCpuSetting {
  const { min, max, default: defaultCpus } = buildCpuRange(reportedCpus(row.probe));
  return {
    cpuCores: Math.min(row.buildCpuQuarters * BUILD_CPU_STEP, max),
    minCpus: min,
    maxCpus: max,
    defaultCpus,
    step: BUILD_CPU_STEP,
  };
}

export async function getBuildCpu(userId: string, serverId: string): Promise<BuildCpuSetting> {
  return cpuSettingOf(await ownedServer(userId, serverId));
}

export async function setBuildCpu(userId: string, serverId: string, cpuCores: number): Promise<BuildCpuSetting> {
  const row = await ownedServer(userId, serverId);
  const problem = checkBuildCpu(cpuCores, reportedCpus(row.probe));
  if (problem) throw new HttpError(400, problem, "validation");
  const cpuQuarters = Math.round(cpuCores / BUILD_CPU_STEP);
  const db = await getDb();
  await db.update(schema.servers).set({ buildCpuQuarters: cpuQuarters }).where(eq(schema.servers.id, row.id));
  await audit(userId, "server.build_cpu", row.id, { from: row.buildCpuQuarters * BUILD_CPU_STEP, to: cpuCores });
  return cpuSettingOf({ ...row, buildCpuQuarters: cpuQuarters });
}

/** The build memory of one server, only for its owner. Unknown or foreign servers are 404. */
export async function getBuildMemory(userId: string, serverId: string): Promise<BuildMemorySetting> {
  return settingOf(await ownedServer(userId, serverId));
}

/** Set the build memory of one server, only for its owner, inside the range for that server. */
export async function setBuildMemory(userId: string, serverId: string, memoryMb: number): Promise<BuildMemorySetting> {
  const row = await ownedServer(userId, serverId);
  const problem = checkBuildMemory(memoryMb, reportedMemoryMb(row.probe));
  if (problem) throw new HttpError(400, problem, "validation");
  const db = await getDb();
  await db.update(schema.servers).set({ buildMemoryMb: memoryMb }).where(eq(schema.servers.id, row.id));
  await audit(userId, "server.build_memory", row.id, { from: row.buildMemoryMb, to: memoryMb });
  return settingOf({ ...row, buildMemoryMb: memoryMb });
}

import { shellQuote } from "@/server/ssh/connection";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import { dockerComposeProjectName, dockerContainerName, startUnit } from "@/server/deploy/remote";
import { serverDiscriminator, unitName } from "@/server/deploy/layout";
import { HttpError } from "@/server/http";
import { ownedDeployment } from "@/server/projects";
import { getServerForUser, withServerSession } from "@/server/servers";
import { probeSession } from "@/server/ssh/probe";

export type LifecycleAction = "start" | "stop" | "restart" | "scale";
export type LifecycleInput =
  | { action: "start" | "stop" | "restart" }
  | { action: "scale"; memoryMb?: number; cpuPercent?: number };

type Deployment = typeof schema.deployments.$inferSelect;
type Project = typeof schema.projects.$inferSelect;

/** Build a command for one managed production service. Every identifier is generated from DB ids. */
export function lifecycleScript(args: {
  action: LifecycleAction;
  unit: string;
  deploymentMode: string;
  slug: string;
  scope: string;
  memoryMb?: number;
  cpuPercent?: number;
}) {
  if (args.action === "start" || args.action === "restart") return startUnit(args.unit);
  if (args.action === "stop") return `set -euo pipefail\nsystemctl stop ${shellQuote(args.unit)}\necho ${shellQuote(`Stopped ${args.unit}`)}\n`;
  if (args.action !== "scale") throw new HttpError(400, "Unknown lifecycle action.", "validation");

  const limits: string[] = [];
  if (args.memoryMb !== undefined) {
    if (!Number.isInteger(args.memoryMb) || args.memoryMb < 128 || args.memoryMb > 32768) {
      throw new HttpError(400, "Memory must be a whole number from 128 to 32768 MB.", "validation");
    }
  }
  if (args.cpuPercent !== undefined) {
    if (!Number.isInteger(args.cpuPercent) || args.cpuPercent < 1 || args.cpuPercent > 6400) {
      throw new HttpError(400, "CPU must be a whole-number percentage from 1 to 6400.", "validation");
    }
  }
  if (args.memoryMb === undefined && args.cpuPercent === undefined) {
    throw new HttpError(400, "Set a memory or CPU limit to scale this deployment.", "validation");
  }
  if (args.deploymentMode === "native") {
    if (args.memoryMb !== undefined) limits.push(`MemoryMax=${args.memoryMb}M`);
    if (args.cpuPercent !== undefined) limits.push(`CPUQuota=${args.cpuPercent}%`);
    return `set -euo pipefail\nsystemctl set-property ${shellQuote(args.unit)} ${limits.map(shellQuote).join(" ")}\necho 'Updated service resource limits'\n`;
  }

  const container = dockerContainerName(args.slug, undefined, args.scope);
  const dockerArgs = [
    "docker", "update",
    ...(args.memoryMb === undefined ? [] : [`--memory=${args.memoryMb}m`]),
    ...(args.cpuPercent === undefined ? [] : [`--cpus=${Math.max(0.01, args.cpuPercent / 100)}`]),
    container,
  ];
  return `set -euo pipefail\n${dockerArgs.map(shellQuote).join(" ")}\necho 'Updated container resource limits'\n`;
}

async function ownedProduction(userId: string, deploymentId: string) {
  const { dep, project } = await ownedDeployment(userId, deploymentId, "admin");
  // Owner-only even for projects reachable through an organization role.
  if (project.userId !== userId) throw new HttpError(404, "Deployment not found", "not_found");
  if (dep.env !== "production" || dep.state !== "ready" || !dep.isCurrent || dep.cleanedUp) {
    throw new HttpError(409, "Only the current, retained production deployment can be managed.", "conflict");
  }
  return { dep, project };
}

async function run(userId: string, project: Project, script: string) {
  const server = await getServerForUser(userId, project.serverId);
  const result = await withServerSession(server, async (session) => {
    await probeSession(session);
    return session.script(script, { timeoutMs: 30_000 });
  });
  if (result.code !== 0) throw new HttpError(502, "The deployment operation failed on your container.", "upstream");
  return result.stdout.trim();
}

export async function operateDeployment(userId: string, deploymentId: string, input: LifecycleInput) {
  const { dep, project } = await ownedProduction(userId, deploymentId);
  const server = await getServerForUser(userId, project.serverId);
  const scope = serverDiscriminator(server.id);
  const unit = unitName(project.slug, undefined, scope);
  const output = await run(userId, project, lifecycleScript({
    ...input,
    unit,
    deploymentMode: project.deploymentMode,
    slug: project.slug,
    scope,
  }));
  await audit(userId, `deployment.${input.action}`, project.id, {
    deploymentId: dep.id,
    ...(input.action === "scale" ? { memoryMb: input.memoryMb ?? null, cpuPercent: input.cpuPercent ?? null } : {}),
  });
  return { action: input.action, deploymentId: dep.id, output };
}

/** Read the namespaced Docker volumes owned by this project's deployment. */
export async function deploymentVolumes(userId: string, deploymentId: string) {
  const { dep, project } = await ownedProduction(userId, deploymentId);
  if (project.deploymentMode === "native") throw new HttpError(409, "Native deployments do not have Docker volumes.", "conflict");
  const server = await getServerForUser(userId, project.serverId);
  const scope = serverDiscriminator(server.id);
  const volumeNames = await run(
    userId,
    project,
    `set -euo pipefail\ncommand -v docker >/dev/null 2>&1 || { echo 'Docker is unavailable' >&2; exit 1; }\ndocker volume ls --format '{{.Name}}'\n`
  );
  const prefix = `${dockerComposeProjectName(project.slug, scope)}_`;
  const volumes = volumeNames.split(/\r?\n/).filter((name) => name.startsWith(prefix)).sort();
  return { deploymentId: dep.id, volumes };
}

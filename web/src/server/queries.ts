import { cache } from "react";
import { and, asc, count, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import type { BuildLocation } from "@/server/db/schema";
import { isNestName, ownedParentOf } from "@/server/domain-policy";
import { notFound } from "@/server/http";
import { pageLimit, selectDeploymentPage, type DeploymentFilter } from "@/server/deployment-page";
import { getServerForUser, listServers, publicServer } from "@/server/servers";
import { notifySummary } from "@/server/notify";
import { getReadableProject } from "@/server/projects";
import { projectReadableBy } from "@/server/project-roles";
import { statusUrl } from "@/server/status-page";
import { usageFromProbe } from "@/server/runtime-info";
import { durationText, timeAgo, uiState, type UiState } from "@/lib/status";

/**
 * Read models for the dashboard. They return plain, serialisable objects with
 * times already formatted, so pages and client components can use them as is.
 */

export type ProjectView = {
  id: string;
  slug: string;
  name: string;
  /** Always "owner": projects are single-owner. */
  role?: "owner";
  repo: string | null;
  repoUrl: string;
  branch: string;
  runtime: string;
  workloadKind: "web" | "worker";
  deploymentMode: "native" | "dockerfile" | "compose";
  /** Docker-mode settings; null in native mode. */
  dockerfilePath: string | null;
  composeFilePath: string | null;
  composeService: string | null;
  containerPort: number | null;
  listenPort: number | null;
  startCommand: string | null;
  port: number;
  healthPath: string;
  autoDeploy: boolean;
  buildLocation: BuildLocation;
  /** True when a deploy hook exists. The URL is only ever shown when it is created. */
  hookActive: boolean;
  hookCreatedAt: string | null;
  notify: { kind: "discord" | "slack"; on: "all" | "failures" } | null;
  serverId: string;
  nestUsername: string;
  domains: string[];
  /** State of the most recent deployment, or null if never deployed. */
  state: UiState | null;
  lastCommit: string | null;
  lastSha: string | null;
  /** Full SHA of the most recent deployment, for linking to the commit. */
  lastShaFull: string | null;
  lastAge: string | null;
  latestDeploymentId: string | null;
  /** Result of the worker's last uptime check. */
  monitor: "unknown" | "up" | "down";
  monitorSince: string | null;
  analyticsKey: string | null;
  statusUrl: string | null;
  /** Owner opt-in: the latest deployments are listed on the Egg homepage (public repositories only). */
  homepageFeed: boolean;
  /** True when Egg can check the repository with GitHub, which listing on the homepage needs. */
  homepageFeedPossible: boolean;
};

export type DeploymentView = {
  id: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  /** `owner/name` of the GitHub repository, or null when the project has none. */
  repo: string | null;
  env: "production" | "preview";
  state: UiState;
  rawState: string;
  source: string;
  branch: string;
  sha: string | null;
  commit: string | null;
  /** Pull request number for previews built from one. */
  pr: number | null;
  author: string | null;
  age: string;
  duration: string;
  /** Build time in milliseconds, or null while it is still running or never started. */
  durationMs: number | null;
  port: number;
  isCurrent: boolean;
  cleanedUp: boolean;
  error: string | null;
  createdAt: string;
  /** Always true for the owner unless a caller explicitly hides actions. */
  canAct?: boolean;
};

type DeploymentRow = typeof schema.deployments.$inferSelect;

function toDeploymentView(
  d: DeploymentRow,
  project: { id: string; userId: string; slug: string; name: string; repoFullName: string | null },
  userId: string,
  canAct = true
): DeploymentView {
  return {
    id: d.id,
    projectId: project.id,
    projectSlug: project.userId === userId ? project.slug : `~${project.id}`,
    projectName: project.name,
    canAct,
    repo: project.repoFullName,
    env: d.env,
    state: uiState(d.state),
    rawState: d.state,
    source: d.source,
    branch: d.branch,
    sha: d.commitSha,
    commit: d.commitMessage,
    pr: d.prNumber,
    author: d.author,
    age: timeAgo(d.createdAt),
    duration: durationText(d.startedAt, d.finishedAt),
    durationMs: d.startedAt && d.finishedAt ? Math.max(0, d.finishedAt.getTime() - d.startedAt.getTime()) : null,
    port: d.port,
    isCurrent: d.isCurrent,
    cleanedUp: d.cleanedUp,
    error: d.error,
    createdAt: d.createdAt.toISOString(),
  };
}

async function loadProjectViews(userId: string): Promise<ProjectView[]> {
  const db = await getDb();
  const projects = await db
    .select({ p: schema.projects, nest: schema.servers.nestUsername })
    .from(schema.projects)
    .innerJoin(schema.servers, eq(schema.servers.id, schema.projects.serverId))
    .where(projectReadableBy(userId))
    .orderBy(desc(schema.projects.createdAt));
  if (projects.length === 0) return [];

  const deployments = await db
    .select({ d: schema.deployments })
    .from(schema.projects)
    .innerJoin(schema.deployments, sql`${schema.deployments.id} = (select id from deployments latest where latest.project_id = ${schema.projects.id} order by latest.created_at desc, latest.id desc limit 1)`)
    .where(projectReadableBy(userId));
  const latest = new Map<string, DeploymentRow>();
  for (const { d } of deployments) {
    if (!latest.has(d.projectId)) latest.set(d.projectId, d);
  }

  const domains = await db
    .select()
    .from(schema.domains)
    .where(inArray(schema.domains.projectId, projects.map(({ p }) => p.id)));
  const domainsByProject = new Map<string, string[]>();
  for (const domain of domains) {
    if (!domain.projectId) continue;
    const list = domainsByProject.get(domain.projectId) ?? [];
    list.push(domain.domain);
    domainsByProject.set(domain.projectId, list);
  }

  return projects.map(({ p, nest }) => {
    const d = latest.get(p.id);
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      role: "owner",
      repo: p.repoFullName,
      repoUrl: p.repoUrl,
      branch: p.productionBranch,
      runtime: p.runtime,
      workloadKind: p.workloadKind,
      deploymentMode: p.deploymentMode,
      dockerfilePath: p.dockerfilePath,
      composeFilePath: p.composeFilePath,
      composeService: p.composeService,
      containerPort: p.containerPort,
      listenPort: p.listenPort ?? (p.workloadKind === "worker" ? null : p.port),
      startCommand: p.startCommand,
      port: p.port,
      healthPath: p.healthPath,
      autoDeploy: p.autoDeploy,
      buildLocation: p.buildLocation,
      hookActive: Boolean(p.hookHash),
      hookCreatedAt: p.hookCreatedAt ? p.hookCreatedAt.toISOString() : null,
      notify: notifySummary(p),
      serverId: p.serverId,
      nestUsername: nest,
      domains: domainsByProject.get(p.id) ?? [],
      state: d ? uiState(d.state) : null,
      lastCommit: d?.commitMessage ?? null,
      lastSha: d?.commitSha?.slice(0, 7) ?? null,
      lastShaFull: d?.commitSha ?? null,
      lastAge: d ? timeAgo(d.createdAt) : null,
      latestDeploymentId: d?.id ?? null,
      monitor: p.monitorState,
      monitorSince: p.monitorSince ? timeAgo(p.monitorSince) : null,
      analyticsKey: p.analyticsKey,
      statusUrl: p.statusKey ? statusUrl(p.statusKey) : null,
      homepageFeed: p.homepageFeed,
      homepageFeedPossible: Boolean(p.repoFullName) && p.installationId !== null,
    };
  });
}

/**
 * Every project a person has. The shell, the top bar and the page each ask for
 * this on one request; React runs the query once and hands the same answer to
 * all of them. (Outside a React render it simply runs every time.)
 */
export const projectViews = cache(loadProjectViews);

export async function projectBySlug(userId: string, slug: string) {
  const views = await projectViews(userId);
  const v = views.find((p) => p.slug === slug);
  if (!v) throw notFound("Project not found");
  return v;
}

export type DeploymentPage = { rows: DeploymentView[]; nextCursor: string | null };

/**
 * One page of deployments, newest first. `cursor` is the `nextCursor` of the
 * previous page (an invalid one is a 400). The size is 25 unless asked, at most 100.
 */
export async function deploymentPage(
  userId: string,
  options: { projectId?: string; limit?: number; cursor?: string | null; filter?: DeploymentFilter } = {}
): Promise<DeploymentPage> {
  const { rows, nextCursor } = await selectDeploymentPage(userId, {
    projectId: options.projectId,
    cursor: options.cursor,
    filter: options.filter,
    limit: pageLimit(options.limit),
  });
  return { rows: rows.map(({ d, p }) => toDeploymentView(d, p, userId)), nextCursor };
}

/** The newest deployments in one list, 100 unless `limit` says otherwise. */
export async function deploymentViews(
  userId: string,
  options: { projectId?: string; limit?: number } = {}
): Promise<DeploymentView[]> {
  const { rows } = await selectDeploymentPage(userId, {
    projectId: options.projectId,
    limit: Math.max(1, Math.floor(options.limit ?? 100)),
  });
  return rows.map(({ d, p }) => toDeploymentView(d, p, userId));
}

export async function deploymentView(userId: string, deploymentId: string) {
  const db = await getDb();
  const row = await db
    .select({ d: schema.deployments, p: schema.projects })
    .from(schema.deployments)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.deployments.projectId))
    .where(and(eq(schema.deployments.id, deploymentId), projectReadableBy(userId)))
    .get();
  if (!row) throw notFound("Deployment not found");
  const domains = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.projectId, row.p.id));
  return {
    deployment: toDeploymentView(row.d, row.p, userId),
    project: {
      id: row.p.id,
      slug: row.p.slug,
      name: row.p.name,
      port: row.p.port,
    },
    domains: domains.map((x) => x.domain),
  };
}

async function loadServerViews(userId: string) {
  const rows = await listServers(userId);
  const db = await getDb();
  const counts = await db
    .select({ serverId: schema.projects.serverId, n: count() })
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId))
    .groupBy(schema.projects.serverId);
  const projectsOn = new Map(counts.map((c) => [c.serverId, c.n]));
  return rows.map((r) => {
    const view = publicServer(r);
    return {
      ...view,
      projectCount: projectsOn.get(r.id) ?? 0,
      usage: view.probe ? usageFromProbe(view.probe, r.lastCheckedAt ?? new Date()) : null,
    };
  });
}

/** The person's servers, once per request, for the same reason as projectViews. */
export const serverViews = cache(loadServerViews);

export type ServerView = Awaited<ReturnType<typeof serverViews>>[number];

export type UsagePoint = {
  at: number;
  /** Each figure as a share of its total, 0 to 1. Null when it was not measured. */
  cpu: number | null;
  mem: number | null;
  disk: number | null;
};

const share = (used: number | null, total: number | null) =>
  used !== null && total ? Math.min(Math.max(used / total, 0), 1) : null;

/** Usage samples the worker took for one server, oldest first. */
export async function usageHistory(
  userId: string,
  serverId: string,
  hours = 24
): Promise<UsagePoint[]> {
  const server = await getServerForUser(userId, serverId);
  const db = await getDb();
  const since = new Date(Date.now() - hours * 3_600_000);
  const rows = await db
    .select()
    .from(schema.usageSamples)
    .where(and(eq(schema.usageSamples.serverId, server.id), gte(schema.usageSamples.at, since)))
    .orderBy(asc(schema.usageSamples.at));
  return rows.map((r) => ({
    at: r.at.getTime(),
    cpu: r.cpuLoad !== null && r.cpus ? Math.min(r.cpuLoad / r.cpus, 1) : null,
    mem: share(r.memUsedMb, r.memTotalMb),
    disk: share(r.diskUsedMb, r.diskTotalMb),
  }));
}

export async function domainViews(userId: string) {
  const db = await getDb();
  const rows = await db
    .select({
      d: schema.domains,
      nest: schema.servers.nestUsername,
      project: schema.projects.name,
    })
    .from(schema.domains)
    .innerJoin(schema.servers, eq(schema.servers.id, schema.domains.serverId))
    .leftJoin(schema.projects, eq(schema.projects.id, schema.domains.projectId))
    .where(or(eq(schema.domains.userId, userId), projectReadableBy(userId)))
    .orderBy(schema.domains.createdAt);
  return rows.map(({ d, nest, project }) => {
    // A Nest name, or a subdomain of a domain already verified here, has no record to add.
    const kind = isNestName(d.domain, nest)
      ? "nest"
      : ownedParentOf(
            d.domain,
            rows.filter((r) => r.d.id !== d.id && r.d.serverId === d.serverId).map((r) => r.d)
          )
        ? "subdomain"
        : "custom";
    return {
      id: d.id,
      domain: d.domain,
      port: d.port,
      status: d.status,
      serverId: d.serverId,
      nestUsername: nest,
      projectName: project,
      projectId: d.projectId,
      kind: kind as "nest" | "subdomain" | "custom",
      cname: kind === "custom" ? `${nest}.hackclub.app` : null,
      txt: kind === "custom" ? `domain-verification=${nest}` : null,
      age: timeAgo(d.createdAt),
    };
  });
}

export type ProjectSamplePoint = {
  at: number;
  memMb: number | null;
  cpuPercent: number | null;
};

/** Memory and CPU samples of one project's service, oldest first. */
export async function projectMetrics(
  userId: string,
  projectId: string,
  hours = 24
): Promise<ProjectSamplePoint[]> {
  const project = await getReadableProject(userId, projectId);
  const db = await getDb();
  const since = new Date(Date.now() - hours * 3_600_000);
  const rows = await db
    .select()
    .from(schema.projectSamples)
    .where(and(eq(schema.projectSamples.projectId, project.id), gte(schema.projectSamples.at, since)))
    .orderBy(asc(schema.projectSamples.at));
  return rows.map((r) => ({ at: r.at.getTime(), memMb: r.memMb, cpuPercent: r.cpuPercent }));
}

export type ProjectResource = {
  id: string;
  serverId: string;
  slug: string;
  name: string;
  /** Result of the worker's last uptime check. */
  monitor: "unknown" | "up" | "down";
  memNow: number | null;
  memPeak: number | null;
  cpuNow: number | null;
  cpuPeak: number | null;
  restarts: number | null;
  points: ProjectSamplePoint[];
};

/** What each of the user's projects used over the last `hours`, from the worker's samples. */
export async function projectResources(userId: string, hours = 24): Promise<ProjectResource[]> {
  const db = await getDb();
  const projects = await db
    .select({
      id: schema.projects.id,
      serverId: schema.projects.serverId,
      slug: schema.projects.slug,
      name: schema.projects.name,
      monitor: schema.projects.monitorState,
    })
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId))
    .orderBy(asc(schema.projects.name));
  if (projects.length === 0) return [];

  const since = new Date(Date.now() - hours * 3_600_000);
  const samples = await db
    .select()
    .from(schema.projectSamples)
    .where(
      and(
        inArray(
          schema.projectSamples.projectId,
          projects.map((p) => p.id)
        ),
        gte(schema.projectSamples.at, since)
      )
    )
    .orderBy(asc(schema.projectSamples.at));

  const byProject = new Map<string, typeof samples>();
  for (const r of samples) {
    const list = byProject.get(r.projectId) ?? [];
    list.push(r);
    byProject.set(r.projectId, list);
  }

  return projects.map((p) => {
    const rows = byProject.get(p.id) ?? [];
    const mem = rows.filter((r) => r.memMb !== null);
    const cpu = rows.filter((r) => r.cpuPercent !== null);
    return {
      ...p,
      memNow: mem.at(-1)?.memMb ?? null,
      memPeak: mem.length ? Math.max(...mem.map((r) => r.memMb as number)) : null,
      cpuNow: cpu.at(-1)?.cpuPercent ?? null,
      cpuPeak: cpu.length ? Math.max(...cpu.map((r) => r.cpuPercent as number)) : null,
      restarts: rows.at(-1)?.restarts ?? null,
      points: rows.map((r) => ({ at: r.at.getTime(), memMb: r.memMb, cpuPercent: r.cpuPercent })),
    };
  });
}

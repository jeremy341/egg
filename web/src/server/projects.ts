import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { pickCloneSettings, type CloneSettings } from "@/server/clone-settings";
import { newId, open, seal } from "@/server/crypto";
import { getDb, schema, type Db } from "@/server/db";
import { isUniqueViolation } from "@/server/db/errors";
import { pageLimit, selectDeploymentPage, type DeploymentFilter } from "@/server/deployment-page";
import { BUILD_LOCATIONS, RUNTIMES, WORKLOAD_KINDS, DEPLOYMENT_MODES } from "@/server/db/schema";
import { assertCloneUrl, BuildError } from "@/server/deploy/build";
import { isValidSlug, slugify } from "@/server/deploy/layout";
import { ENV_KEY, RESERVED_ENV } from "@/server/deploy/runtime";
import { assertInstallationOwned, GithubError } from "@/server/github/app";
import { HttpError, notFound } from "@/server/http";
import { moveDomainsToPort } from "@/server/domains";
import { getServerForUser } from "@/server/servers";
import { assertCleanupAllowsWork } from "@/server/cleanup-guards";
import { maintenanceBlocksUser } from "@/server/maintenance";
import { projectReadableBy } from "@/server/project-roles";
import { forgetDeliveriesForDeployments } from "@/server/webhooks";
import { providerClientForUser, publicProviderClient, repositoryNameFromUrl, validateProviderSource } from "@/server/providers/connections";
import { genericGitEnvironment } from "@/server/providers/generic";

export type ProjectRow = typeof schema.projects.$inferSelect;
export type DeploymentRow = typeof schema.deployments.$inferSelect;

/** Hide the legacy compatibility port for portless workers at API boundaries. */
export function projectResponse(project: ProjectRow) {
  const { providerWebhookSecretEnc: _secret, ...safe } = project;
  void _secret;
  // A worker with a listen port (a webhook bot) exposes it; a portless worker stays closed.
  const listen = project.listenPort ?? (project.workloadKind === "worker" ? null : project.port);
  return { ...safe, port: listen, listenPort: listen, healthPath: project.workloadKind === "worker" ? null : project.healthPath };
}
export function deploymentResponse(deployment: DeploymentRow) {
  return { ...deployment, port: deployment.port === 0 ? null : deployment.port };
}

/** Previews get ports from this range so they never collide with production. */
export const PREVIEW_PORT_MIN = 20000;
export const PREVIEW_PORT_MAX = 29999;

const command = z
  .string()
  .trim()
  .max(500)
  .refine((v) => !/[\r\n]/.test(v), "Commands must be a single line")
  .nullable()
  .optional();

const rootDir = z
  .string()
  .trim()
  .max(200)
  .refine(
    (v) => !v.startsWith("/") && !v.split(/[\\/]/).includes(".."),
    "Root directory must be a relative path inside the repository"
  )
  .default(".");

/** A file path relative to the repository root, for Dockerfile and Compose file paths. */
const repoFilePath = z
  .string()
  .trim()
  .max(200)
  .refine(
    (v) => !v.startsWith("/") && !v.split(/[\\/]/).includes(".."),
    "Must be a relative path inside the repository"
  );

const branch = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._/-]+$/, "Branch names may use letters, digits, . _ - and /")
  .refine((v) => !v.startsWith("-") && !v.includes(".."), "Invalid branch name");

const port = z
  .number()
  .int()
  .min(1024)
  .max(65535)
  .refine(
    (p) => p < PREVIEW_PORT_MIN || p > PREVIEW_PORT_MAX,
    `Ports ${PREVIEW_PORT_MIN} to ${PREVIEW_PORT_MAX} are reserved for previews`
  );

export const createProjectInput = z.object({
  serverId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  slug: z.string().trim().toLowerCase().optional(),
  repoUrl: z.string().trim().max(300),
  repoFullName: z.string().trim().max(200).nullable().optional(),
  sourceProvider: z.enum(["github", "gitlab", "forgejo", "codeberg", "generic"]).default("github"),
  providerConnectionId: z.string().min(1).max(64).nullable().optional(),
  installationId: z.number().int().positive().nullable().optional(),
  productionBranch: branch.default("main"),
  rootDir,
  runtime: z.enum(RUNTIMES),
  workloadKind: z.enum(WORKLOAD_KINDS).default("web"),
  deploymentMode: z.enum(DEPLOYMENT_MODES).default("native"),
  /** Dockerfile path relative to the repository root; used only in "dockerfile" mode. */
  dockerfilePath: repoFilePath.nullable().optional(),
  /** Compose file path relative to the repository root; used only in "compose" mode. */
  composeFilePath: repoFilePath.nullable().optional(),
  /** The Compose service that is deployed; used only in "compose" mode. */
  composeService: z.string().trim().max(100).nullable().optional(),
  /** Port the container image listens on; used only in Docker modes. */
  containerPort: port.nullable().optional(),
  installCommand: command,
  buildCommand: command,
  startCommand: command,
  outputDir: z.string().trim().max(200).nullable().optional(),
  /** Where builds run: "container" (the default) or "github" (a GitHub Actions workflow uploads the release). */
  buildLocation: z.enum(BUILD_LOCATIONS).optional(),
  buildCacheEnabled: z.boolean().optional(),
  port: port.optional(),
  listenPort: port.nullable().optional(),
  healthPath: z.string().trim().max(200).regex(/^\//, "Must start with /").default("/"),
  autoDeploy: z.boolean().default(true),
  /**
   * The project is being adopted from a container that already runs things
   * (an existing checkout, or a cleared conflict). It starts with auto deploy
   * off, so nothing ships until the first deploy has been confirmed by hand.
   */
  adopted: z.boolean().default(false),
});

/**
 * An update changes only what it sends. Zod 4 fills a default into a key that is left out, even
 * under .partial(), so the defaults of the create schema are removed here first. Otherwise a rename
 * would silently reset the branch, root folder, health path and auto deploy.
 */
export const updateProjectInput = createProjectInput
  .omit({ serverId: true, slug: true, repoUrl: true, repoFullName: true, installationId: true, sourceProvider: true, providerConnectionId: true, adopted: true })
  .extend({
    productionBranch: createProjectInput.shape.productionBranch.removeDefault(),
    rootDir: createProjectInput.shape.rootDir.removeDefault(),
    healthPath: createProjectInput.shape.healthPath.removeDefault(),
    autoDeploy: createProjectInput.shape.autoDeploy.removeDefault(),
    workloadKind: createProjectInput.shape.workloadKind.removeDefault(),
    deploymentMode: createProjectInput.shape.deploymentMode.removeDefault(),
  })
  .partial();

export type CreateProjectInput = z.infer<typeof createProjectInput>;

async function assertOwned(userId: string, projectId: string): Promise<ProjectRow> {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();
  if (!row) throw notFound("Project not found");
  return row;
}
export const getProjectForUser = assertOwned;

/** Explicitly scoped read access; callers must not return this row directly. */
export async function getReadableProject(userId: string, projectId: string): Promise<ProjectRow> {
  const db = await getDb();
  const project = await db.select().from(schema.projects).where(and(eq(schema.projects.id, projectId), projectReadableBy(userId))).get();
  if (!project) throw notFound("Project not found");
  return project;
}

async function getDevelopableProject(userId: string, projectId: string): Promise<ProjectRow> {
  const db = await getDb();
  const project = await db.select().from(schema.projects).where(and(eq(schema.projects.id, projectId), sql`(
    ${schema.projects.userId} = ${userId} or exists (
      select 1 from project_members pm where pm.project_id = ${schema.projects.id} and pm.user_id = ${userId} and pm.role = 'developer'
    ))`)).get();
  if (!project) throw notFound("Project not found");
  return project;
}

export async function listProjects(userId: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId))
    .orderBy(desc(schema.projects.createdAt));
}

/**
 * The GitHub fields come from the client, and an installation token reads
 * private repositories, so both are checked: the installation must be one this
 * user linked, and the repository name (which routes push events to the
 * project) must be the one in the repository URL.
 */
async function assertGithubLinks(
  userId: string,
  input: { installationId?: number | null; repoUrl: string; repoFullName?: string | null }
) {
  if (input.installationId) {
    try {
      await assertInstallationOwned(userId, input.installationId);
    } catch (e) {
      if (e instanceof GithubError) throw new HttpError(403, e.message, "forbidden");
      throw e;
    }
  }
  if (input.repoFullName) {
    const path = new URL(input.repoUrl).pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    if (path.toLowerCase() !== input.repoFullName.toLowerCase()) {
      throw new HttpError(400, "The repository name does not match the repository URL.", "validation");
    }
  }
}

export async function createProject(userId: string, raw: unknown): Promise<ProjectRow> {
  const input = createProjectInput.parse(raw);
  if (input.port !== undefined && input.listenPort !== undefined && input.port !== input.listenPort) throw new HttpError(400, "Port and listenPort must agree.", "validation");
  const selectedPort = input.listenPort !== undefined ? input.listenPort : input.port;
  if (input.workloadKind === "web" && selectedPort == null) throw new HttpError(400, "A web project needs a port.", "validation");
  if (input.workloadKind === "worker" && input.runtime === "static") throw new HttpError(400, "Static sites need a web workload.", "validation");
  if (input.deploymentMode === "dockerfile" && !input.dockerfilePath) throw new HttpError(400, "A Dockerfile project needs the Dockerfile path.", "validation");
  if (input.deploymentMode === "compose" && (!input.composeFilePath || !input.composeService)) throw new HttpError(400, "A Compose project needs the Compose file path and the service to run.", "validation");
  if (input.deploymentMode !== "native" && input.buildLocation === "github") throw new HttpError(400, "Container projects build their image on your server. GitHub build settings are for native projects.", "validation");
  const db = await getDb();
  await getServerForUser(userId, input.serverId);
  let providerRepoName = input.repoFullName ?? null;

  if (input.sourceProvider === "github") {
    if (input.providerConnectionId) throw new HttpError(400, "GitHub uses an installation, not a provider connection.", "validation");
    try { assertCloneUrl(input.repoUrl); } catch (e) {
      if (e instanceof BuildError) throw new HttpError(400, e.message, "validation");
      throw e;
    }
    await assertGithubLinks(userId, input);
  } else if (input.sourceProvider === "generic") {
    if (input.providerConnectionId || input.installationId || input.buildLocation === "github") throw new HttpError(400, "Generic Git supports public HTTPS only.", "validation");
    try { await genericGitEnvironment(input.repoUrl); } catch { throw new HttpError(400, "Enter a public HTTPS repository on a public host.", "validation"); }
  } else {
    if (input.installationId || input.buildLocation === "github") throw new HttpError(400, "GitHub build settings cannot be used for this provider.", "validation");
    const api = input.providerConnectionId ? await providerClientForUser(userId, input.providerConnectionId, input.sourceProvider) : publicProviderClient(input.sourceProvider, input.repoUrl);
    providerRepoName ??= repositoryNameFromUrl(input.repoUrl);
    await validateProviderSource(api, { repoFullName: providerRepoName, repoUrl: input.repoUrl, productionBranch: input.productionBranch }, !input.providerConnectionId);
  }

  const slug = input.slug ? input.slug : slugify(input.name);
  if (!isValidSlug(slug)) {
    throw new HttpError(
      400,
      "The project name must use lowercase letters, digits and hyphens (up to 40).",
      "validation"
    );
  }
  // Preview and job services are named egg-<slug>-pv-<id8> and egg-<slug>-job-<id8>;
  // a project with a matching suffix would own the same unit file stem as
  // another project's live service, so the name is refused up front.
  if (/-(?:pv|job)-[0-9a-f]{8}$/.test(slug)) {
    throw new HttpError(
      400,
      'The project name cannot end with "-pv-" or "-job-" and eight characters, like "-pv-1a2b3c4d". Choose another name.',
      "validation"
    );
  }

  const mine = await db
    .select({ slug: schema.projects.slug })
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId));
  if (mine.some((p) => p.slug === slug)) {
    throw new HttpError(409, `You already have a project called "${slug}".`, "conflict");
  }

  const id = newId();
  const now = new Date();
  // The port check and the insert are one write transaction, so two requests for the same
  // port cannot both pass the check before either row exists.
  await db.transaction(async (tx) => {
    await assertCleanupAllowsWork(tx, userId);
    // Derived names on the server (systemd unit, container, ~/.egg/<slug> folder, image,
    // Compose project) are built from the slug alone, so two projects with the same slug
    // on one server would silently kill each other's units. A slug is unique per server,
    // not just per user.
    const onServer = await tx
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.serverId, input.serverId), eq(schema.projects.slug, slug)));
    if (onServer.length > 0) {
      throw new HttpError(409, `A project called "${slug}" already runs on this server. Slugs are unique per server, so choose another name.`, "conflict");
    }
    if (selectedPort != null) await assertPortFree(
      tx,
      input.serverId,
      selectedPort,
      `Port ${selectedPort} is already used by another project on this server.`
    );
    await tx.insert(schema.projects).values({
      id,
      userId,
      serverId: input.serverId,
      slug,
      name: input.name,
      repoUrl: input.repoUrl,
      repoFullName: providerRepoName,
      sourceProvider: input.sourceProvider,
      providerConnectionId: input.providerConnectionId ?? null,
      installationId: input.installationId ?? null,
      productionBranch: input.productionBranch,
      rootDir: input.rootDir,
      runtime: input.runtime,
      workloadKind: input.workloadKind,
      deploymentMode: input.deploymentMode,
      // Container settings only mean something in Docker modes; native projects
      // store none, so switching modes never leaves stale file paths behind.
      dockerfilePath: input.deploymentMode === "dockerfile" ? input.dockerfilePath ?? null : null,
      composeFilePath: input.deploymentMode === "compose" ? input.composeFilePath ?? null : null,
      composeService: input.deploymentMode === "compose" ? input.composeService ?? null : null,
      containerPort: input.deploymentMode === "native" ? null : input.containerPort ?? null,
      installCommand: input.installCommand || null,
      buildCommand: input.buildCommand || null,
      startCommand: input.startCommand || null,
      outputDir: input.outputDir || null,
      buildLocation: input.buildLocation ?? "container",
      buildCacheEnabled: input.buildCacheEnabled ?? false,
      port: selectedPort ?? 0,
      listenPort: selectedPort ?? null,
      healthPath: input.healthPath,
      autoDeploy: input.sourceProvider !== "github" || input.adopted ? false : input.autoDeploy,
      createdAt: now,
      updatedAt: now,
    }).catch((err: unknown) => {
      // The slug and port pre-checks can still race a concurrent create; the
      // unique indexes have the final word, and every collision must surface as
      // a clean conflict naming the real loser, not a raw database error.
      if (isUniqueViolation(err)) {
        throw createProjectConflict(err, slug, `Port ${selectedPort} is already used by another project on this server.`);
      }
      throw err;
    });
  });
  await audit(userId, "project.create", id, { name: input.name });
  return assertOwned(userId, id);
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Walks the error chain for the first unique-violation message, like isUniqueViolation. */
function uniqueViolationMessage(err: unknown): string {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const message = String((e as { message?: unknown }).message ?? "");
    if (/UNIQUE constraint failed/i.test(message)) return message;
    e = (e as { cause?: unknown }).cause;
  }
  return "";
}

/** Maps a unique-index violation from the project insert to the matching conflict message. */
function createProjectConflict(err: unknown, slug: string, portMessage: string): HttpError {
  const message = uniqueViolationMessage(err);
  if (/projects_server_slug_idx|projects\.server_id, projects\.slug/.test(message)) {
    return new HttpError(409, `A project called "${slug}" already runs on this server. Slugs are unique per server, so choose another name.`, "conflict");
  }
  if (/projects_server_listen_port_idx|listen_port/.test(message)) {
    return new HttpError(409, portMessage, "conflict");
  }
  return new HttpError(409, `You already have a project called "${slug}".`, "conflict");
}

/** 409 when another project on this server already has the port. Call inside the write transaction. */
async function assertPortFree(tx: Tx, serverId: string, port: number, message: string, exceptId?: string) {
  const taken = await tx
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.serverId, serverId), eq(schema.projects.listenPort, port)));
  if (taken.some((p) => p.id !== exceptId)) throw new HttpError(409, message, "conflict");
}

export async function updateProject(userId: string, projectId: string, raw: unknown) {
  const input = updateProjectInput.parse(raw);
  const project = await assertOwned(userId, projectId);
  if (input.autoDeploy && project.sourceProvider !== "github" && !project.providerWebhookSecretEnc) throw new HttpError(400, "Configure a provider webhook before enabling automatic deployments.", "validation");
  if (input.workloadKind && input.workloadKind !== project.workloadKind) throw new HttpError(400, "Create a separate project to change between a web service and a worker.", "validation");
  if (input.port !== undefined && input.listenPort !== undefined && input.port !== input.listenPort) throw new HttpError(400, "Port and listenPort must agree.", "validation");
  const selectedPort = input.listenPort !== undefined ? input.listenPort : input.port;
  // Workers may set or clear their listen port; a web project keeps a port at all times.
  const portTouched = input.port !== undefined || input.listenPort !== undefined;
  if (project.workloadKind === "web" && portTouched && selectedPort === null) throw new HttpError(400, "A web project needs a port.", "validation");
  if (project.workloadKind === "worker" && input.runtime === "static") throw new HttpError(400, "Static sites need a web workload.", "validation");
  const selectedMode = input.deploymentMode ?? project.deploymentMode;
  if (selectedMode === "dockerfile" && (input.dockerfilePath ?? project.dockerfilePath) == null) throw new HttpError(400, "A Dockerfile project needs the Dockerfile path.", "validation");
  if (selectedMode === "compose" && (input.composeFilePath ?? project.composeFilePath) == null) throw new HttpError(400, "A Compose project needs the Compose file path.", "validation");
  if (selectedMode === "compose" && (input.composeService ?? project.composeService) == null) throw new HttpError(400, "A Compose project needs the service to run.", "validation");
  if (selectedMode !== "native" && (input.buildLocation ?? project.buildLocation) === "github") throw new HttpError(400, "Container projects build their image on your server. GitHub build settings are for native projects.", "validation");
  const db = await getDb();

  const clean = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined)
  ) as Partial<typeof schema.projects.$inferInsert>;
  if (portTouched) {
    if (selectedPort != null) { clean.port = selectedPort; clean.listenPort = selectedPort; }
    else if (project.workloadKind === "worker") { clean.port = 0; clean.listenPort = null; }
  }
  if (selectedMode === "native") {
    // Container settings only mean something in Docker modes; keep the stored
    // set in step with the mode so switching back never resurrects stale paths.
    clean.dockerfilePath = null;
    clean.composeFilePath = null;
    clean.composeService = null;
    clean.containerPort = null;
  }
  const newPort = selectedPort != null && selectedPort !== project.port ? selectedPort : null;
  await db.transaction(async (tx) => {
    await assertCleanupAllowsWork(tx, userId, projectId);
    if (newPort !== null || (portTouched && selectedPort === null && project.listenPort != null)) {
      // A queued or running deployment pins the old port: changing it under the
      // worker lets a second project claim the freed port and end up with the
      // old release listening on it.
      const active = await tx
        .select({ id: schema.deployments.id })
        .from(schema.deployments)
        .where(and(
          eq(schema.deployments.projectId, project.id),
          inArray(schema.deployments.state, ["queued", "building", "deploying"]),
        ))
        .get();
      if (active) {
        throw new HttpError(409, "A deployment is still running for this project. Wait for it to finish before changing its port.", "conflict");
      }
      if (newPort !== null) {
        await assertPortFree(tx, project.serverId, newPort, `Port ${newPort} is already used on this server.`, project.id);
      }
    }
    await tx
      .update(schema.projects)
      .set({ ...clean, updatedAt: new Date() })
      .where(eq(schema.projects.id, project.id))
      .catch((err: unknown) => {
        // The pre-check races a concurrent update only in theory (one writer at a
        // time in SQLite), but a unique violation must surface as a clean
        // conflict, not a raw database error.
        if (isUniqueViolation(err)) {
          throw new HttpError(409, `Port ${newPort} is already used on this server.`, "conflict");
        }
        throw err;
      });
    // Nest holds the real port mapping: a domain left on the old port must say so.
    if (newPort !== null) await moveDomainsToPort(tx, project.id, newPort);
  });
  await audit(userId, "project.update", project.id, { fields: Object.keys(clean).join(", ") });
  return assertOwned(userId, projectId);
}

// ------------------------------------------------------------ environment

export const envInput = z.object({
  key: z
    .string()
    .trim()
    .regex(ENV_KEY, "Names use letters, digits and underscores, and do not start with a digit")
    .max(100)
    .refine((k) => !RESERVED_ENV.has(k.toUpperCase()), "That name is set by Egg"),
  value: z.string().max(10_000),
  target: z.enum(["all", "production", "preview"]).default("all"),
});

export async function setEnvVar(userId: string, projectId: string, raw: unknown) {
  const input = envInput.parse(raw);
  const project = await assertOwned(userId, projectId);
  const db = await getDb();

  await db.transaction(async (tx) => {
    await assertCleanupAllowsWork(tx, userId, project.id);
    const existing = await tx
      .select({ id: schema.envVars.id })
      .from(schema.envVars)
      .where(
        and(
          eq(schema.envVars.projectId, project.id),
          eq(schema.envVars.key, input.key),
          eq(schema.envVars.target, input.target)
        )
      )
      .get();
    const valueEnc = seal(input.value, `env:${project.id}:${input.key}:${input.target}`);
    if (existing) {
      await tx.update(schema.envVars).set({ valueEnc }).where(eq(schema.envVars.id, existing.id));
    } else {
      const count = await tx
        .select({ n: sql<number>`count(*)` })
        .from(schema.envVars)
        .where(eq(schema.envVars.projectId, project.id))
        .get();
      if ((count?.n ?? 0) >= 100) {
        throw new HttpError(400, "A project can have up to 100 variables.", "limit");
      }
      await tx.insert(schema.envVars).values({
        id: newId(),
        projectId: project.id,
        key: input.key,
        valueEnc,
        target: input.target,
        createdAt: new Date(),
      });
    }
  });
  await audit(userId, "env.set", project.id, { name: input.key, target: input.target });
}

/** Names and targets only. Values are never sent back to the browser. */
export async function listEnvVars(userId: string, projectId: string) {
  const project = await assertOwned(userId, projectId);
  const db = await getDb();
  const rows = await db
    .select({ id: schema.envVars.id, key: schema.envVars.key, target: schema.envVars.target })
    .from(schema.envVars)
    .where(eq(schema.envVars.projectId, project.id))
    .orderBy(schema.envVars.key);
  return rows;
}

export async function deleteEnvVar(userId: string, projectId: string, envId: string) {
  const project = await assertOwned(userId, projectId);
  const db = await getDb();
  await db.transaction(async (tx) => {
    await assertCleanupAllowsWork(tx, userId, project.id);
    await tx.delete(schema.envVars)
      .where(and(eq(schema.envVars.id, envId), eq(schema.envVars.projectId, project.id)));
  });
  await audit(userId, "env.delete", project.id);
}

/** Only used by the worker and tests. */
export async function revealEnvVar(projectId: string, key: string, target: "all" | "production" | "preview") {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.envVars)
    .where(
      and(
        eq(schema.envVars.projectId, projectId),
        eq(schema.envVars.key, key),
        eq(schema.envVars.target, target)
      )
    )
    .get();
  return row ? open(row.valueEnc, `env:${projectId}:${key}:${target}`) : null;
}

// ------------------------------------------------------------ deployments

async function allocatePreviewPort(tx: Tx, serverId: string): Promise<number> {
  const used = await tx
    .select({ port: schema.deployments.port })
    .from(schema.deployments)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.deployments.projectId))
    .where(
      and(
        eq(schema.projects.serverId, serverId),
        eq(schema.deployments.env, "preview"),
        eq(schema.deployments.cleanedUp, false),
        inArray(schema.deployments.state, ["queued", "building", "deploying", "ready"])
      )
    );
  const taken = new Set(used.map((u) => u.port));
  for (let p = PREVIEW_PORT_MIN; p <= PREVIEW_PORT_MAX; p++) {
    if (!taken.has(p)) return p;
  }
  throw new HttpError(409, "No free preview ports on this server.", "limit");
}

export type NewDeployment = {
  env: "production" | "preview";
  source: DeploymentRow["source"];
  branch: string;
  commitSha?: string | null;
  commitMessage?: string | null;
  author?: string | null;
  prNumber?: number | null;
  triggeredBy?: string | null;
  /** Reuse an existing release (rollback). */
  releaseId?: string;
  port?: number;
};

/** Insert a queued deployment and its job in one go. */
export async function enqueueDeployment(
  project: ProjectRow,
  input: NewDeployment,
  jobType: "deploy" | "rollback" = "deploy"
): Promise<DeploymentRow> {
  const db = await getDb();
  const id = newId();
  const enqueue = () => db.transaction(async (tx) => {
    if (input.triggeredBy && input.triggeredBy !== project.userId) {
      const member = await tx.select({ role: schema.projectMembers.role }).from(schema.projectMembers).where(and(
        eq(schema.projectMembers.projectId, project.id), eq(schema.projectMembers.userId, input.triggeredBy)
      )).get();
      if (member?.role !== "developer") throw notFound("Project not found");
    }
    await assertCleanupAllowsWork(tx, project.userId, project.id);
    if (await maintenanceBlocksUser(project.userId, tx)) throw new HttpError(503, "Maintenance is active. New deployments are paused.", "maintenance");
    // A port is what production uses: the worker's listen port, or the web project's port.
    // Previews are web traffic (PRs); a worker preview stays portless and is checked as a process.
    const port = project.workloadKind === "worker"
      ? input.env === "production" ? project.listenPort ?? 0 : 0
      : input.port ??
      (input.env === "production" ? project.port : await allocatePreviewPort(tx, project.serverId));
    await tx.insert(schema.deployments).values({
      id,
      projectId: project.id,
      triggeredBy: input.triggeredBy ?? null,
      env: input.env,
      state: "queued",
      source: input.source,
      branch: input.branch,
      commitSha: input.commitSha ?? null,
      commitMessage: input.commitMessage ?? null,
      prNumber: input.prNumber ?? null,
      author: input.author ?? null,
      port,
      listenPort: port === 0 ? null : port,
      releaseId: input.releaseId ?? newId(),
      createdAt: new Date(),
    });
    await tx.insert(schema.jobs).values({
      id: newId(),
      type: jobType,
      deploymentId: id,
      projectId: project.id,
      state: "queued",
      createdAt: new Date(),
    });
  });
  // SQLite can reject a concurrent write transaction immediately. Retry only lock
  // contention; constraint and application errors must reach the caller unchanged.
  for (let attempt = 0; ; attempt++) {
    try {
      await enqueue();
      break;
    } catch (err) {
      if (attempt >= 49 || !(err instanceof Error) || !/SQLITE_BUSY|SQLITE_LOCKED/.test(err.message)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 20 + attempt * 5));
    }
  }
  return (await db.select().from(schema.deployments).where(eq(schema.deployments.id, id)).get())!;
}

/** Deploy a branch by hand (the "Deploy" button). */
export async function deployBranch(
  userId: string,
  projectId: string,
  branchName?: string
) {
  const project = await getDevelopableProject(userId, projectId);
  const b = branchName ?? project.productionBranch;
  return enqueueDeployment(project, {
    env: b === project.productionBranch ? "production" : "preview",
    source: "manual",
    branch: b,
    triggeredBy: userId,
  });
}

/** Who asked for an action: the API token that made it, when one did. */
export type ActionVia = { tokenId?: string };

/** The audit detail for an API call, so the log shows which token did it. */
function viaMeta(via: ActionVia): Record<string, string> {
  return via.tokenId ? { via: "api", token: via.tokenId } : {};
}

/** Build the same commit again. */
export async function redeploy(userId: string, deploymentId: string, via: ActionVia = {}) {
  const { project, dep } = await developerDeployment(userId, deploymentId);
  await audit(userId, "deploy.redeploy", project.id, { branch: dep.branch, ...viaMeta(via) });
  return enqueueDeployment(project, {
    env: dep.env,
    source: "redeploy",
    branch: dep.branch,
    commitSha: dep.commitSha,
    commitMessage: dep.commitMessage,
    author: dep.author,
    triggeredBy: userId,
  });
}

/** Point production back at an earlier release that is still on the server. */
export async function rollback(userId: string, deploymentId: string, via: ActionVia = {}) {
  const { project, dep } = await developerDeployment(userId, deploymentId);
  if (dep.env !== "production") {
    throw new HttpError(400, "Only production deployments can be rolled back to.", "validation");
  }
  if (dep.state !== "ready") {
    throw new HttpError(400, "That deployment never finished, so there is nothing to roll back to.", "validation");
  }
  if (dep.cleanedUp) {
    throw new HttpError(409, "That release was removed from your server to save space.", "gone");
  }
  if (dep.isCurrent) {
    throw new HttpError(409, "That deployment is already live.", "conflict");
  }
  await audit(userId, "deploy.rollback", project.id, {
    sha: dep.commitSha?.slice(0, 7) ?? null,
    ...viaMeta(via),
  });
  return enqueueDeployment(
    project,
    {
      env: "production",
      source: "rollback",
      branch: dep.branch,
      commitSha: dep.commitSha,
      commitMessage: dep.commitMessage,
      author: dep.author,
      triggeredBy: userId,
      releaseId: dep.releaseId,
      port: project.port,
    },
    "rollback"
  );
}

export async function cancelDeployment(userId: string, deploymentId: string, via: ActionVia = {}) {
  const { project, dep } = await developerDeployment(userId, deploymentId);
  const db = await getDb();
  // This conditional write races atomically with the worker's activation CAS.
  // Exactly one side wins: a cancel before activation, or the activation lock.
  const canceled = await db
    .update(schema.deployments)
    .set({ state: "canceled", finishedAt: new Date(), error: "Canceled" })
    .where(
      and(
        eq(schema.deployments.id, dep.id),
        inArray(schema.deployments.state, ["queued", "building", "deploying"]),
        isNull(schema.deployments.activationStartedAt)
      )
    )
    .returning({ id: schema.deployments.id });
  if (canceled.length === 0) {
    throw new HttpError(409, "Activation has started or this deployment is already finished.", "conflict");
  }
  await db
    .update(schema.jobs)
    .set({ state: "failed", error: "Canceled" })
    .where(and(eq(schema.jobs.deploymentId, dep.id), eq(schema.jobs.state, "queued")));
  await audit(userId, "deploy.cancel", project.id, { branch: dep.branch, ...viaMeta(via) });
}

export async function ownedDeployment(userId: string, deploymentId: string) {
  const db = await getDb();
  const dep = await db
    .select()
    .from(schema.deployments)
    .where(eq(schema.deployments.id, deploymentId))
    .get();
  if (!dep) throw notFound("Deployment not found");
  const project = await assertOwned(userId, dep.projectId);
  return { dep, project };
}

async function scopedDeployment(userId: string, deploymentId: string, role: "viewer" | "developer") {
  const db = await getDb();
  const dep = await db.select().from(schema.deployments).where(eq(schema.deployments.id, deploymentId)).get();
  if (!dep) throw notFound("Deployment not found");
  const project = role === "viewer" ? await getReadableProject(userId, dep.projectId) : await getDevelopableProject(userId, dep.projectId);
  return { dep, project };
}
export const readableDeployment = (userId: string, deploymentId: string) => scopedDeployment(userId, deploymentId, "viewer");
export const developerDeployment = (userId: string, deploymentId: string) => scopedDeployment(userId, deploymentId, "developer");

export async function listDeployments(userId: string, projectId?: string, limit = 50) {
  return (await listDeploymentsPage(userId, { projectId, limit })).rows;
}

/**
 * One page of deployments, newest first, with a `nextCursor` for the page
 * after it (null on the last page). A cursor that is not valid is a 400.
 */
export async function listDeploymentsPage(
  userId: string,
  options: { projectId?: string; limit?: number; cursor?: string | null; filter?: DeploymentFilter } = {}
) {
  const { rows, nextCursor } = await selectDeploymentPage(userId, {
    projectId: options.projectId,
    cursor: options.cursor,
    filter: options.filter,
    limit: options.limit === undefined ? 50 : pageLimit(options.limit),
  });
  return {
    rows: rows.map(({ d, p }) => ({ deployment: d, projectName: p.name, projectSlug: p.slug })),
    nextCursor,
  };
}

export async function deploymentLogs(userId: string, deploymentId: string, afterId = 0, limit = 1000) {
  await readableDeployment(userId, deploymentId);
  const db = await getDb();
  return db
    .select()
    .from(schema.deploymentLogs)
    .where(
      and(
        eq(schema.deploymentLogs.deploymentId, deploymentId),
        sql`${schema.deploymentLogs.id} > ${afterId}`
      )
    )
    .orderBy(schema.deploymentLogs.id)
    .limit(limit);
}

/** Delete a project's records (deployments, logs and env vars cascade). */
export async function deleteProjectRecords(userId: string, projectId: string) {
  const project = await assertOwned(userId, projectId);
  const db = await getDb();
  await db.transaction(async (tx) => {
    await assertCleanupAllowsWork(tx, userId, projectId);
    const activeJob = await tx
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .innerJoin(schema.deployments, eq(schema.jobs.deploymentId, schema.deployments.id))
      .where(and(eq(schema.deployments.projectId, project.id), eq(schema.jobs.state, "running")))
      .get();
    if (activeJob) {
      throw new HttpError(409, "A deployment is still stopping for this project. Wait for it to finish, then delete the project.", "conflict");
    }
    // The worker would keep writing a service and folders for a project that no longer exists.
    const running = await tx
      .select({ id: schema.deployments.id })
      .from(schema.deployments)
      .where(
        and(
          eq(schema.deployments.projectId, project.id),
          inArray(schema.deployments.state, ["queued", "building", "deploying"])
        )
      )
      .get();
    if (running) {
      throw new HttpError(
        409,
        "A deployment is still running for this project. Cancel it or wait for it to finish, then delete the project.",
        "conflict"
      );
    }
    const deployments = await tx
      .select({ id: schema.deployments.id })
      .from(schema.deployments)
      .where(eq(schema.deployments.projectId, project.id));
    await tx.delete(schema.projects).where(eq(schema.projects.id, project.id));
    // The cascade removes the deployments; their delivery history survives by
    // design, so the links that would now point at nothing are forgotten here.
    await forgetDeliveriesForDeployments(tx, deployments.map((d) => d.id));
  });
  await audit(userId, "project.delete", null, { name: project.name });
}

// ------------------------------------------------------------ clone settings

/** A project's own build and run settings (the allow-listed fields only). */
export async function getBuildSettings(userId: string, projectId: string): Promise<CloneSettings> {
  return pickCloneSettings(await assertOwned(userId, projectId));
}

/** Other projects on the same server that settings can be copied from. */
export async function listCloneSources(userId: string, projectId: string) {
  const project = await assertOwned(userId, projectId);
  const db = await getDb();
  const rows = await db
    .select({ id: schema.projects.id, name: schema.projects.name, runtime: schema.projects.runtime })
    .from(schema.projects)
    .where(and(eq(schema.projects.userId, userId), eq(schema.projects.serverId, project.serverId)))
    .orderBy(schema.projects.name);
  return rows.filter((r) => r.id !== project.id);
}

/**
 * The build and run settings of another project on the same server, for the
 * settings form to show. Nothing is written: the caller saves through the
 * normal update, after the user has reviewed the values.
 */
export async function getCloneSettings(
  userId: string,
  projectId: string,
  sourceId: string
): Promise<CloneSettings> {
  const project = await assertOwned(userId, projectId);
  const source = await assertOwned(userId, sourceId);
  if (source.id === project.id) {
    throw new HttpError(400, "Pick a different project to copy from.", "validation");
  }
  if (source.serverId !== project.serverId) {
    throw new HttpError(400, "You can only copy from a project on the same server.", "validation");
  }
  return pickCloneSettings(source);
}

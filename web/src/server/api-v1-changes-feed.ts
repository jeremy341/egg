import { and, desc, eq, inArray, lt, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { describeAction } from "@/server/audit";
import {
  formatMeta,
  KIND_PREFIXES,
  kindOf,
  makeCursor,
  parseCursor,
  parseMeta,
  tokenIdOf,
  type ActivityKind,
} from "@/server/activity";
import {
  endpoint,
  NOT_FOUND_NOTE,
  projectIdInput,
  type Endpoint,
} from "@/server/api-v1-kit";
import { getDb, schema } from "@/server/db";
import { getProjectForUser } from "@/server/projects";

const changeKindSchema = z.enum([
  "projects",
  "deployments",
  "domains",
  "servers",
  "access",
  "monitoring",
  "terminal",
]);

const changeSchema = z.object({
  time: z.string().describe("When the change happened, in ISO 8601."),
  kind: changeKindSchema,
  actor: z.string().describe("The project owner or the access token that made the change."),
  summary: z.string().describe("A one-line summary. Environment changes include key names only, never values."),
  deploymentId: z.string().optional().describe("The deployment id when the audit row identifies one."),
});

type ChangeKind = Exclude<ActivityKind, "other">;
type ChangeRow = typeof schema.auditLog.$inferSelect;

function textMeta(meta: unknown): Record<string, string | number | boolean> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return meta as Record<string, string | number | boolean>;
}

function stringMeta(meta: Record<string, string | number | boolean>, key: string): string | null {
  const value = meta[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function summarize(row: ChangeRow, projectName: string): string {
  const meta = parseMeta(row.meta);
  const { clean, suffix } = formatMeta(row.action, meta);
  const label = describeAction(row.action);

  // Environment audit rows are deliberately summarized from names and target
  // only. A malformed or future meta value can never turn into a secret leak.
  if (row.action.startsWith("env.")) {
    const name = stringMeta(clean, "name");
    const target = row.action === "env.set" ? stringMeta(clean, "target") : null;
    const detail = name ? `: ${name}${target ? ` (${target})` : ""}` : "";
    return `${label} ${projectName}${detail}`;
  }

  const target = row.action.startsWith("domain.") ? stringMeta(clean, "domain") ?? projectName : projectName;
  return [label, target, suffix].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function deploymentIdFor(row: ChangeRow, projectDeployments: Set<string>): string | undefined {
  if (row.target && projectDeployments.has(row.target)) return row.target;
  const meta = textMeta(parseMeta(row.meta));
  for (const key of ["deploymentId", "deployment"]) {
    const value = stringMeta(meta, key);
    if (value && projectDeployments.has(value)) return value;
  }
  return undefined;
}

export async function apiGetChanges(
  p: Principal,
  projectId: string,
  input: { limit: number; cursor?: string }
) {
  requireScope(p, "activity:read");
  const project = await getProjectForUser(p.userId, projectId);
  const db = await getDb();
  const deployments = await db
    .select({ id: schema.deployments.id })
    .from(schema.deployments)
    .where(eq(schema.deployments.projectId, projectId));
  const projectDeploymentIds = deployments.map((deployment) => deployment.id);
  const projectDeploymentSet = new Set(projectDeploymentIds);

  const changePrefixes = (Object.values(KIND_PREFIXES) as readonly string[][]).flat();
  const conditions: SQL[] = [
    eq(schema.auditLog.userId, p.userId),
    inArray(schema.auditLog.target, [projectId, ...projectDeploymentIds]),
    or(...changePrefixes.map((prefix) => sql`${schema.auditLog.action} GLOB ${`${prefix}*`}`))!,
  ];
  const after = parseCursor(input.cursor);
  if (after) {
    conditions.push(
      or(
        lt(schema.auditLog.at, after.at),
        and(eq(schema.auditLog.at, after.at), lt(schema.auditLog.id, after.id))
      )!
    );
  }

  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(and(...conditions))
    .orderBy(desc(schema.auditLog.at), desc(schema.auditLog.id))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const pageRows = rows.slice(0, input.limit);

  const tokenIds = [...new Set(pageRows.map((row) => tokenIdOf(parseMeta(row.meta))).filter((id): id is string => Boolean(id)))];
  const [owner, tokens] = await Promise.all([
    db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, project.userId)).get(),
    tokenIds.length
      ? db.select({ id: schema.apiTokens.id, name: schema.apiTokens.name }).from(schema.apiTokens).where(inArray(schema.apiTokens.id, tokenIds))
      : Promise.resolve([]),
  ]);
  const tokenNames = new Map(tokens.map((token) => [token.id, token.name]));

  const items = pageRows.map((row) => {
    const tokenId = tokenIdOf(parseMeta(row.meta));
    const kind = kindOf(row.action);
    const deploymentId = deploymentIdFor(row, projectDeploymentSet);
    return {
      time: row.at.toISOString(),
      kind: kind as ChangeKind,
      actor: tokenId ? tokenNames.get(tokenId) ?? "API token" : owner?.name?.trim() || "User",
      summary: summarize(row, project.name),
      ...(deploymentId ? { deploymentId } : {}),
    };
  });

  return {
    items,
    nextCursor: hasMore && pageRows.length ? makeCursor(pageRows.at(-1)!.at.toISOString(), pageRows.at(-1)!.id) : null,
  };
}

export const CHANGES_FEED_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "get_changes",
    method: "GET",
    path: "/projects/{projectId}/changes",
    scope: "activity:read",
    bucket: "read",
    tag: "Activity",
    summary: "Read a project's changes",
    description: `Read the change-type audit entries for one of your projects, newest first. The kind follows the Activity page's categories. Environment entries may show a variable key name, never its value. Page with limit and the returned nextCursor as cursor. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId: projectIdInput },
    query: {
      limit: z.coerce.number().int().min(1).max(100).default(50).describe("How many changes, 1 to 100."),
      cursor: z
        .string()
        .max(40)
        .regex(/^\d{1,15}\.\d{1,12}$/, "Not a cursor from a previous page")
        .optional()
        .describe("The nextCursor of the previous page."),
    },
    response: z.object({ items: z.array(changeSchema), nextCursor: z.string().nullable() }),
    errors: [400, 404],
    run: (p, input) => apiGetChanges(p, input.projectId, { limit: input.limit, cursor: input.cursor }),
  }),
];

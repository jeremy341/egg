import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  accessSettingsInput,
  getAccessSettings,
  saveAccessSettings,
  type AccessSettingsView,
} from "@/server/access-protection";
import { requireScope, type Principal } from "@/server/api-tokens";
import { domainIdInput, endpoint, NOT_FOUND_NOTE, type Endpoint } from "@/server/api-v1-kit";
import { domainSchema, publicDomainFor } from "@/server/api-v1-models";
import { getDb } from "@/server/db";
import { domainPatch, listDomains, updateDomain } from "@/server/domains";
import { HttpError, notFound } from "@/server/http";

/**
 * Orchard calls a domain an ingress. Egg records domains in `domains.ts` and
 * keeps an ingress's access protection as the settings of the project it
 * serves (`access-protection.ts`). These endpoints address both by domain id,
 * so an agent can read and change an ingress without knowing which part of the
 * app owns it. The scope, ownership and validation rules are the same as the
 * ones the dashboard uses.
 */

const ingressInstructions = z.object({
  steps: z.array(z.string()),
  cname: z.object({ name: z.string(), value: z.string() }).nullable(),
  txt: z.object({ name: z.string(), value: z.string() }).nullable(),
});

const protectionSchema = z.object({
  mode: z.enum(["open", "password", "sign_in", "basic-auth"]),
  excludedPaths: z.array(z.string()),
  passwordSet: z.boolean(),
}) satisfies z.ZodType<AccessSettingsView>;

/**
 * `access-protection.ts` reads its config table with drizzle's raw-SQL `.get()`, which throws
 * when the query has no row. An ingress whose project was never configured must still read as
 * open and be writable, so check with `.all()` first and seed an "off" row on the first write.
 */
async function hasAccessRow(projectId: string): Promise<boolean> {
  const db = await getDb();
  await db.run(sql`CREATE TABLE IF NOT EXISTS project_access_protection (
    project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    config_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  const rows = await db.all<{ config_json: string }>(sql`SELECT config_json FROM project_access_protection WHERE project_id = ${projectId}`);
  return rows.length > 0;
}

const openProtection = (): AccessSettingsView => ({ mode: "open", excludedPaths: [], passwordSet: false });

/** The domain id resolves the project whose access settings protect the ingress. */
async function protectedProject(userId: string, domainId: string): Promise<string> {
  const domain = (await listDomains(userId)).find((item) => item.id === domainId);
  if (!domain) throw notFound("Domain not found");
  if (!domain.projectId) {
    throw new HttpError(400, "This domain is not attached to a project, so it has no access protection.", "validation");
  }
  return domain.projectId;
}

export async function apiGetIngress(p: Principal, domainId: string) {
  requireScope(p, "domains:read");
  return { domain: await publicDomainFor(p, domainId) };
}

export async function apiUpdateIngress(p: Principal, domainId: string, changes: unknown) {
  requireScope(p, "domains:write");
  // `domainPatch` carries the "at least one field" refinement that the endpoint's flattened
  // input schema cannot. Turn its failure into the same 400 the HTTP layer would send.
  const parsed = domainPatch.safeParse(changes);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Nothing to change", "validation");
  }
  const updated = await updateDomain(p.userId, domainId, parsed.data);
  return {
    domain: await publicDomainFor(p, domainId),
    needsNestChange: updated.needsNestChange,
    instructions: updated.instructions,
  };
}

export async function apiGetIngressProtection(p: Principal, domainId: string) {
  requireScope(p, "domains:read");
  const projectId = await protectedProject(p.userId, domainId);
  if (!(await hasAccessRow(projectId))) return { protection: openProtection() };
  return { protection: await getAccessSettings(p.userId, projectId) };
}

export async function apiSetIngressProtection(
  p: Principal,
  domainId: string,
  input: z.output<typeof accessSettingsInput>
) {
  requireScope(p, "domains:write");
  const projectId = await protectedProject(p.userId, domainId);
  if (!(await hasAccessRow(projectId))) {
    const db = await getDb();
    await db.run(
      sql`INSERT INTO project_access_protection(project_id, config_json, updated_at)
        VALUES (${projectId}, ${JSON.stringify({ mode: "off", excludedPaths: [] })}, ${new Date().toISOString()})`
    );
  }
  return { protection: await saveAccessSettings(p.userId, projectId, input) };
}

export const DOMAIN_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "get_ingress",
    method: "GET",
    path: "/domains/{domainId}",
    scope: "domains:read",
    bucket: "read",
    tag: "Domains",
    summary: "Get one ingress (domain)",
    description: `Read a single domain the token owner can see, with its status, target port, project and CNAME target. Use list_domains to find the id. ${NOT_FOUND_NOTE}`,
    pathParams: { domainId: domainIdInput },
    response: z.object({ domain: domainSchema }),
    errors: [400, 404],
    run: (p, i) => apiGetIngress(p, i.domainId),
  }),
  endpoint({
    id: "update_ingress",
    method: "PATCH",
    path: "/domains/{domainId}",
    scope: "domains:write",
    bucket: "write",
    tag: "Domains",
    summary: "Re-point an ingress",
    description: `Change a domain's target port and/or project. Send at least one of projectId or port; passing null for projectId detaches it. Changing the port puts the domain back to pending and returns dashboard instructions, because the Nest dashboard still maps the old port. ${NOT_FOUND_NOTE}`,
    pathParams: { domainId: domainIdInput },
    body: domainPatch.shape,
    response: z.object({
      domain: domainSchema,
      needsNestChange: z.boolean().describe("True when the Nest dashboard must be updated as well."),
      instructions: ingressInstructions.nullable(),
    }),
    errors: [400, 404],
    run: (p, i) => apiUpdateIngress(p, i.domainId, { projectId: i.projectId, port: i.port }),
  }),
  endpoint({
    id: "get_ingress_protection",
    method: "GET",
    path: "/domains/{domainId}/protection",
    scope: "domains:read",
    bucket: "read",
    tag: "Domains",
    summary: "Read an ingress's access protection",
    description: `Read how the project served by a domain is protected: open, shared password, Egg sign-in or basic authentication, plus the paths excluded from the check. Credentials are never returned, only whether a password is set. Needs the domain to be attached to a project. Returns 400 otherwise. ${NOT_FOUND_NOTE}`,
    pathParams: { domainId: domainIdInput },
    response: z.object({ protection: protectionSchema }),
    errors: [400, 404],
    run: (p, i) => apiGetIngressProtection(p, i.domainId),
  }),
  endpoint({
    id: "set_ingress_protection",
    method: "PUT",
    path: "/domains/{domainId}/protection",
    scope: "domains:write",
    bucket: "write",
    tag: "Domains",
    summary: "Change an ingress's access protection",
    description: `Set the access mode and excluded paths of the project served by a domain. Modes are open, password (send a new password to replace the old one), sign_in and basic-auth (keeps the server-side credentials already set in the dashboard). Passwords are hashed before storage and never returned. Needs the domain to be attached to a project. ${NOT_FOUND_NOTE}`,
    pathParams: { domainId: domainIdInput },
    body: accessSettingsInput.shape,
    response: z.object({ protection: protectionSchema }),
    errors: [400, 404],
    run: (p, i) => {
      const { domainId, ...settings } = i;
      return apiSetIngressProtection(p, domainId, settings);
    },
  }),
];

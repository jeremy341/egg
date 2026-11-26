import { z } from "zod";
import type { Principal } from "@/server/api-tokens";
import { endpoint, type Endpoint } from "@/server/api-v1-kit";
import { getOrganizationFor, listOrganizationsFor } from "@/server/organizations";

const orgIdInput = z.string().trim().min(1).max(100).describe("The organization's id, from list_organizations.");
const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.enum(["guest", "member", "admin", "owner"]),
  createdAt: z.string().datetime(),
});

export async function apiListOrganizations(p: Principal) {
  const organizations = await listOrganizationsFor(p.userId);
  return organizations.map((organization) => ({
    ...organization,
    createdAt: organization.createdAt.toISOString(),
  }));
}

export async function apiGetOrganization(p: Principal, orgId: string) {
  const organization = await getOrganizationFor(p.userId, orgId);
  return { ...organization, createdAt: organization.createdAt.toISOString() };
}

export const ORG_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "list_organizations",
    method: "GET",
    path: "/organizations",
    scope: "projects:read",
    bucket: "read",
    tag: "Account",
    summary: "List your organizations",
    description: "List the organizations the token owner belongs to, including their role. This is read-only and does not include organizations belonging only to other users.",
    response: z.array(organizationSchema),
    run: (p) => apiListOrganizations(p),
  }),
  endpoint({
    id: "get_organization",
    method: "GET",
    path: "/organizations/{orgId}",
    scope: "projects:read",
    bucket: "read",
    tag: "Account",
    summary: "Read an organization",
    description: "Read one organization the token owner belongs to, including their role. Non-members receive 404. This is read-only; it cannot change organization settings or membership.",
    pathParams: { orgId: orgIdInput },
    response: organizationSchema,
    errors: [404],
    run: (p, i) => apiGetOrganization(p, i.orgId),
  }),
];

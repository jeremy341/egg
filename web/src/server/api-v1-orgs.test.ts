import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal, Scope } from "@/server/api-tokens";
import { callEndpoint } from "@/server/api-v1";
import { ORG_ENDPOINTS } from "@/server/api-v1-orgs";
import { upsertUser } from "@/server/auth/session";
import { createOrganization } from "@/server/organizations";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let owner: { id: string };
let outsider: { id: string };
let organizationId: string;

const endpoint = (id: string) => {
  const found = ORG_ENDPOINTS.find((item) => item.id === id);
  expect(found, `endpoint ${id} exists`).toBeDefined();
  if (!found) throw new Error(`Missing endpoint ${id}`);
  return found;
};
const principal = (userId: string, scopes: Scope[]): Principal => ({ userId, tokenId: "org-token", scopes });
const call = (userId: string, scopes: Scope[], id: string, input: unknown = {}) =>
  callEndpoint(principal(userId, scopes), endpoint(id), input);

beforeAll(async () => {
  ctx = await useFreshDb();
  owner = await upsertUser({ id: "org-api-owner", name: "Owner", email: null, slackId: null });
  outsider = await upsertUser({ id: "org-api-outsider", name: "Outsider", email: null, slackId: null });
  organizationId = (await createOrganization(owner.id, "Owner Org")).id;
  await createOrganization(outsider.id, "Outsider Org");
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("organization API endpoints", () => {
  it("exports only owner-scoped read operations", () => {
    expect(ORG_ENDPOINTS.map((item) => item.id)).toEqual(["list_organizations", "get_organization"]);
    expect(ORG_ENDPOINTS.every((item) => item.method === "GET" && item.readOnly && !item.destructive)).toBe(true);
    expect(ORG_ENDPOINTS.every((item) => item.scope === "projects:read")).toBe(true);
  });

  it("lists only organizations visible to the token owner", async () => {
    await expect(call(owner.id, ["projects:read"], "list_organizations")).resolves.toMatchObject([
      { id: organizationId, name: "Owner Org", role: "owner" },
    ]);
    await expect(call(outsider.id, ["projects:read"], "list_organizations")).resolves.toMatchObject([
      { name: "Outsider Org", role: "owner" },
    ]);
  });

  it("reads an organization for its token owner and hides other users' organizations", async () => {
    await expect(call(owner.id, ["projects:read"], "get_organization", { orgId: organizationId })).resolves.toMatchObject({
      id: organizationId,
      name: "Owner Org",
      role: "owner",
    });
    await expect(call(outsider.id, ["projects:read"], "get_organization", { orgId: organizationId })).rejects.toMatchObject({ status: 404 });
  });

  it("requires projects:read", async () => {
    await expect(call(owner.id, ["logs:read"], "list_organizations")).rejects.toMatchObject({ status: 403 });
    await expect(call(owner.id, ["logs:read"], "get_organization", { orgId: organizationId })).rejects.toMatchObject({ status: 403 });
  });
});

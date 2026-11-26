import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Principal } from "@/server/api-tokens";
import { callEndpoint } from "@/server/api-v1";
import { SERVICES_ENDPOINTS } from "@/server/api-v1-services";
import { projectSchema } from "@/server/api-v1-models";
import { upsertUser } from "@/server/auth/session";
import { newId } from "@/server/crypto";
import { schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let ownerId: string;
let serverId: string;
let foreignDomainId: string;
const principal = (userId: string, scopes: Principal["scopes"]): Principal => ({ userId, tokenId: "token", scopes });
const endpoint = (id: string) => {
  const found = SERVICES_ENDPOINTS.find((item) => item.id === id);
  if (!found) throw new Error(`No endpoint named ${id}`);
  return found;
};

beforeAll(async () => {
  ctx = await useFreshDb();
  ownerId = (await upsertUser({ id: "services-owner", name: "Owner", email: null, slackId: null })).id;
  const foreignId = (await upsertUser({ id: "services-foreign", name: "Foreign", email: null, slackId: null })).id;
  serverId = (await createServer(ownerId, "services-owner-server")).id;
  const foreignServerId = (await createServer(foreignId, "services-foreign-server")).id;
  const now = new Date();
  foreignDomainId = newId();
  await ctx.db.insert(schema.domains).values({
    id: foreignDomainId,
    userId: foreignId,
    serverId: foreignServerId,
    projectId: null,
    domain: "foreign.example.com",
    port: 3001,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(async () => ctx.cleanup());

describe("service endpoints", () => {
  it("exports service CRUD and public exposure/port operations", () => {
    expect(SERVICES_ENDPOINTS.map(({ id, method, path }) => ({ id, method, path }))).toEqual([
      { id: "list_services", method: "GET", path: "/services" },
      { id: "create_service", method: "POST", path: "/services" },
      { id: "delete_service", method: "DELETE", path: "/services/{serviceId}" },
      { id: "set_service_exposure", method: "PATCH", path: "/services/{serviceId}/exposure" },
      { id: "set_service_port_public", method: "PATCH", path: "/services/{serviceId}/port" },
    ]);
  });

  it("requires the read scope before listing services", async () => {
    await expect(callEndpoint(principal(ownerId, []), endpoint("list_services"), {})).rejects.toMatchObject({ status: 403 });
  });

  it("does not expose project credentials in the public service schema", () => {
    const keys = Object.keys(projectSchema.shape);
    expect(keys).not.toContain("deployHook");
    expect(keys).not.toContain("credential");
    expect(keys).not.toContain("token");
  });

  it("requires write scopes for mutations", async () => {
    for (const id of ["create_service", "delete_service", "set_service_exposure", "set_service_port_public"]) {
      await expect(callEndpoint(principal(ownerId, ["projects:read"]), endpoint(id), {})).rejects.toBeInstanceOf(HttpError);
    }
  });

  it("creates, lists, exposes, changes the public port and deletes only the owner's service", async () => {
    const createResult = await callEndpoint(principal(ownerId, ["projects:write"]), endpoint("create_service"), {
      serverId,
      name: "Public service",
      slug: "public-service",
      repoUrl: "https://github.com/example/public-service.git",
      runtime: "node",
      port: 3400,
    }) as { service: { id: string } };
    const serviceId = createResult.service.id;
    const domainId = newId();
    const now = new Date();
    await ctx.db.insert(schema.domains).values({
      id: domainId,
      userId: ownerId,
      serverId,
      projectId: null,
      domain: "public.example.com",
      port: 3400,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    const list = await callEndpoint(principal(ownerId, ["projects:read"]), endpoint("list_services"), {}) as { services: { id: string }[] };
    expect(list.services.map(({ id }) => id)).toContain(serviceId);

    await expect(callEndpoint(principal(ownerId, ["domains:write"]), endpoint("set_service_exposure"), {
      serviceId,
      domainId: foreignDomainId,
      exposed: true,
    })).rejects.toMatchObject({ status: 404 });

    await callEndpoint(principal(ownerId, ["domains:write"]), endpoint("set_service_exposure"), {
      serviceId,
      domainId,
      exposed: true,
    });
    const exposedDomain = await ctx.db.select().from(schema.domains).where(eq(schema.domains.id, domainId)).get();
    expect(exposedDomain?.projectId).toBe(serviceId);

    await callEndpoint(principal(ownerId, ["projects:write"]), endpoint("set_service_port_public"), { serviceId, port: 3500 });
    const movedDomain = await ctx.db.select().from(schema.domains).where(eq(schema.domains.id, domainId)).get();
    expect(movedDomain?.port).toBe(3500);

    await callEndpoint(principal(ownerId, ["projects:write"]), endpoint("delete_service"), { serviceId, confirmName: "Public service" });
    const afterDelete = await callEndpoint(principal(ownerId, ["projects:read"]), endpoint("list_services"), {}) as { services: { id: string }[] };
    expect(afterDelete.services.map(({ id }) => id)).not.toContain(serviceId);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Principal, Scope } from "@/server/api-tokens";
import { callEndpoint } from "@/server/api-v1";
import { DOMAIN_ENDPOINTS } from "@/server/api-v1-domains";
import { upsertUser } from "@/server/auth/session";
import { newId } from "@/server/crypto";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let me: { id: string };
let other: { id: string };
let myServerId: string;
let myProjectId: string;
let myDomainId: string;
let orphanDomainId: string;
let theirDomainId: string;
const password = "a-long-test-password-1234";

const principal = (userId: string, scopes: Scope[]): Principal => ({ userId, tokenId: "t", scopes });
const endpoint = (id: string) => {
  const found = DOMAIN_ENDPOINTS.find((item) => item.id === id);
  if (!found) throw new Error(`No endpoint named ${id}`);
  return found;
};

beforeAll(async () => {
  ctx = await useFreshDb();
  me = await upsertUser({ id: "dom-owner", name: "Sam", email: null, slackId: null });
  other = await upsertUser({ id: "dom-other", name: "Kim", email: null, slackId: null });
  myServerId = (await createServer(me.id, "sam-dom")).id;
  const theirServerId = (await createServer(other.id, "kim-dom")).id;
  myProjectId = (await createProject(me.id, {
    repoUrl: "https://github.com/sam/app.git",
    runtime: "node",
    serverId: myServerId,
    name: "App",
    slug: "app",
    port: 3000,
  })).id;
  const theirProjectId = (await createProject(other.id, {
    repoUrl: "https://github.com/kim/app.git",
    runtime: "node",
    serverId: theirServerId,
    name: "Theirs",
    slug: "theirs",
    port: 3100,
  })).id;
  myDomainId = newId();
  orphanDomainId = newId();
  theirDomainId = newId();
  const now = new Date();
  await ctx.db.insert(schema.domains).values([
    { id: myDomainId, userId: me.id, serverId: myServerId, projectId: myProjectId, domain: "app.example.com", port: 3000, status: "valid", createdAt: now, updatedAt: now },
    { id: orphanDomainId, userId: me.id, serverId: myServerId, projectId: null, domain: "www.example.com", port: 3000, status: "pending", createdAt: now, updatedAt: now },
    { id: theirDomainId, userId: other.id, serverId: theirServerId, projectId: theirProjectId, domain: "theirs.example.com", port: 3100, status: "valid", createdAt: now, updatedAt: now },
  ]);
});
afterAll(async () => ctx.cleanup());

describe("the ingress endpoint list", () => {
  it("exports exactly the four domain/ingress parity tools", () => {
    expect(DOMAIN_ENDPOINTS.map((e) => e.id)).toEqual([
      "get_ingress",
      "update_ingress",
      "get_ingress_protection",
      "set_ingress_protection",
    ]);
  });

  it("declares the right method, path, scope and bucket for each", () => {
    const table = DOMAIN_ENDPOINTS.map((e) => ({
      id: e.id,
      method: e.method,
      path: e.path,
      scope: e.scope,
      bucket: e.bucket,
      tag: e.tag,
      readOnly: e.readOnly,
    }));
    expect(table).toEqual([
      { id: "get_ingress", method: "GET", path: "/domains/{domainId}", scope: "domains:read", bucket: "read", tag: "Domains", readOnly: true },
      { id: "update_ingress", method: "PATCH", path: "/domains/{domainId}", scope: "domains:write", bucket: "write", tag: "Domains", readOnly: false },
      { id: "get_ingress_protection", method: "GET", path: "/domains/{domainId}/protection", scope: "domains:read", bucket: "read", tag: "Domains", readOnly: true },
      { id: "set_ingress_protection", method: "PUT", path: "/domains/{domainId}/protection", scope: "domains:write", bucket: "write", tag: "Domains", readOnly: false },
    ]);
  });

  it("takes a domain id on every tool and never takes a body on a read", () => {
    for (const ep of DOMAIN_ENDPOINTS) {
      expect(Object.keys(ep.pathParams), ep.id).toEqual(["domainId"]);
      if (ep.readOnly) expect(Object.keys(ep.body), ep.id).toEqual([]);
    }
    expect(Object.keys(endpoint("update_ingress").body).sort()).toEqual(["port", "projectId"]);
    expect(Object.keys(endpoint("set_ingress_protection").body).sort()).toEqual(["excludedPaths", "mode", "password"]);
  });
});

describe("get_ingress", () => {
  it("returns one owned domain in the public shape", async () => {
    const result = await callEndpoint(principal(me.id, ["domains:read"]), endpoint("get_ingress"), { domainId: myDomainId });
    expect(result).toEqual({
      domain: {
        id: myDomainId,
        domain: "app.example.com",
        status: "valid",
        port: 3000,
        projectId: myProjectId,
        projectName: "App",
        serverId: myServerId,
        cname: "sam-dom.hackclub.app",
      },
    });
  });

  it("hides another owner's domain and an unknown id behind 404", async () => {
    for (const domainId of [theirDomainId, newId()]) {
      await expect(callEndpoint(principal(me.id, ["domains:read"]), endpoint("get_ingress"), { domainId })).rejects.toMatchObject({ status: 404 });
    }
  });

  it("checks domains:read before reading anything", async () => {
    await expect(callEndpoint(principal(me.id, ["domains:write"]), endpoint("get_ingress"), { domainId: myDomainId })).rejects.toMatchObject({ status: 403 });
  });
});

describe("update_ingress", () => {
  it("re-points the domain and says when the Nest dashboard needs the same change", async () => {
    const result = (await callEndpoint(principal(me.id, ["domains:write"]), endpoint("update_ingress"), {
      domainId: myDomainId,
      port: 3001,
    })) as { domain: { port: number; status: string }; needsNestChange: boolean; instructions: { steps: string[] } };
    expect(result.needsNestChange).toBe(true);
    expect(result.domain.port).toBe(3001);
    expect(result.domain.status).toBe("pending");
    expect(result.instructions.steps.join(" ")).toContain("target port to 3001");
    const row = await ctx.db.select().from(schema.domains).where(eq(schema.domains.id, myDomainId)).get();
    expect(row?.port).toBe(3001);
  });

  it("refuses an empty change and another owner's domain", async () => {
    await expect(callEndpoint(principal(me.id, ["domains:write"]), endpoint("update_ingress"), { domainId: myDomainId })).rejects.toMatchObject({ status: 400 });
    await expect(callEndpoint(principal(me.id, ["domains:write"]), endpoint("update_ingress"), { domainId: theirDomainId, port: 4000 })).rejects.toMatchObject({ status: 404 });
  });

  it("checks domains:write before changing anything", async () => {
    await expect(callEndpoint(principal(me.id, ["domains:read"]), endpoint("update_ingress"), { domainId: myDomainId, port: 4000 })).rejects.toMatchObject({ status: 403 });
    const row = await ctx.db.select().from(schema.domains).where(eq(schema.domains.id, myDomainId)).get();
    expect(row?.port).toBe(3001);
  });
});

describe("ingress protection", () => {
  it("reads open until protection is set, then reads the mode without ever returning the password", async () => {
    const reader = principal(me.id, ["domains:read"]);
    const before = await callEndpoint(reader, endpoint("get_ingress_protection"), { domainId: myDomainId });
    expect(before).toEqual({ protection: { mode: "open", excludedPaths: [], passwordSet: false } });

    const saved = await callEndpoint(principal(me.id, ["domains:write"]), endpoint("set_ingress_protection"), {
      domainId: myDomainId,
      mode: "password",
      password,
      excludedPaths: ["/health"],
    });
    expect(saved).toEqual({ protection: { mode: "password", excludedPaths: ["/health"], passwordSet: true } });
    expect(JSON.stringify(saved)).not.toContain(password);

    const after = await callEndpoint(reader, endpoint("get_ingress_protection"), { domainId: myDomainId });
    expect(after).toEqual(saved);
    expect(JSON.stringify(after)).not.toContain(password);
    const stored = await ctx.db.get<{ config_json: string }>(sql`SELECT config_json FROM project_access_protection WHERE project_id = ${myProjectId}`);
    expect(stored?.config_json).toContain("scrypt$");
    expect(stored?.config_json).not.toContain(password);
  });

  it("cannot be read or set through a domain that belongs to someone else", async () => {
    const read = { domainId: theirDomainId };
    const write = { ...read, mode: "open", excludedPaths: [] };
    await expect(callEndpoint(principal(me.id, ["domains:read"]), endpoint("get_ingress_protection"), read)).rejects.toMatchObject({ status: 404 });
    await expect(callEndpoint(principal(me.id, ["domains:write"]), endpoint("set_ingress_protection"), write)).rejects.toMatchObject({ status: 404 });
  });

  it("explains that a domain with no project has no protection to configure", async () => {
    await expect(callEndpoint(principal(me.id, ["domains:read"]), endpoint("get_ingress_protection"), { domainId: orphanDomainId })).rejects.toMatchObject({ status: 400 });
    await expect(callEndpoint(principal(me.id, ["domains:write"]), endpoint("set_ingress_protection"), { domainId: orphanDomainId, mode: "open", excludedPaths: [] })).rejects.toMatchObject({ status: 400 });
  });

  it("validates the protection input and checks scopes before saving", async () => {
    const before = await callEndpoint(principal(me.id, ["domains:read"]), endpoint("get_ingress_protection"), { domainId: myDomainId });
    await expect(callEndpoint(principal(me.id, ["domains:write"]), endpoint("set_ingress_protection"), { domainId: myDomainId, mode: "nope", excludedPaths: [] })).rejects.toMatchObject({ status: 400 });
    await expect(callEndpoint(principal(me.id, ["domains:read"]), endpoint("set_ingress_protection"), { domainId: myDomainId, mode: "open", excludedPaths: [] })).rejects.toMatchObject({ status: 403 });
    const after = await callEndpoint(principal(me.id, ["domains:read"]), endpoint("get_ingress_protection"), { domainId: myDomainId });
    expect(after).toEqual(before);
  });
});

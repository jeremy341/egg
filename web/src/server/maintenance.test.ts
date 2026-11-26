import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { useFreshDb } from "@/server/test/db";
import { upsertUser } from "@/server/auth/session";
import { maintenanceBlocksUser, maintenanceState, saveMaintenance } from "@/server/maintenance";
import { handle, ok } from "@/server/http";
import { getCurrentUser } from "@/server/auth/current";
import { callEndpoint } from "@/server/api-v1";
import { endpoint } from "@/server/api-v1-kit";
import { z } from "zod";
import { createApiToken } from "@/server/api-tokens";
import { adminOverview } from "@/server/admin";
import { PUT as saveRoute } from "@/app/api/admin/maintenance/route";

vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let admin: Awaited<ReturnType<typeof upsertUser>>;
let person: Awaited<ReturnType<typeof upsertUser>>;
beforeAll(async () => {
  ctx = await useFreshDb();
  admin = await upsertUser({ id: "maintenance-admin", name: "Admin", email: null, slackId: null });
  person = await upsertUser({ id: "maintenance-person", name: "Person", email: null, slackId: null });
  process.env.SECURITY_REPORT_ADMIN_ID = admin.id;
});
afterAll(async () => { delete process.env.SECURITY_REPORT_ADMIN_ID; await ctx.cleanup(); });

describe("instance maintenance", () => {
  it("denies unconfigured and non-admin control", async () => {
    await expect(saveMaintenance(person.id, { enabled: true, message: "Upgrading" })).rejects.toMatchObject({ status: 403 });
    expect((await maintenanceState()).active).toBe(false);
  });
  it("supports scheduled windows and an explicit admin bypass", async () => {
    const start = new Date(Date.now() + 60_000);
    const end = new Date(start.getTime() + 60_000);
    await saveMaintenance(admin.id, { enabled: true, message: "Upgrading", startsAt: start.toISOString(), endsAt: end.toISOString() });
    expect((await maintenanceState(new Date(start.getTime() - 1))).active).toBe(false);
    expect((await maintenanceState(start)).active).toBe(true);
    expect((await maintenanceState(end)).active).toBe(false);
    await saveMaintenance(admin.id, { enabled: true, message: "Upgrading" });
    expect(await maintenanceBlocksUser(person.id)).toBe(true);
    expect(await maintenanceBlocksUser(admin.id)).toBe(false);
  });
  it("blocks browser writes, preserves reads and safe recovery actions", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(person);
    const route = handle(async () => ok({ ran: true }));
    expect((await route(new NextRequest("http://localhost:3000/api/preferences", { method: "PATCH" }), undefined)).status).toBe(503);
    expect((await route(new NextRequest("http://localhost:3000/api/projects"), undefined)).status).toBe(200);
    expect((await route(new NextRequest("http://localhost:3000/api/auth/logout", { method: "POST" }), undefined)).status).toBe(200);
    expect((await route(new NextRequest("http://localhost:3000/api/deployments/id/cancel", { method: "POST" }), undefined)).status).toBe(200);
    expect((await route(new NextRequest("http://localhost:3000/api/cleanup/id", { method: "PATCH" }), undefined)).status).toBe(200);
    expect((await route(new NextRequest("http://localhost:3000/api/cleanup/id", { method: "DELETE" }), undefined)).status).toBe(200);
    expect((await route(new NextRequest("http://localhost:3000/api/account/cleanup", { method: "POST" }), undefined)).status).toBe(503);
    expect((await route(new NextRequest("http://localhost:3000/api/projects/id/cleanup", { method: "POST" }), undefined)).status).toBe(503);
    vi.mocked(getCurrentUser).mockResolvedValue(admin);
    expect((await route(new NextRequest("http://localhost:3000/api/preferences", { method: "PATCH" }), undefined)).status).toBe(200);
  });
  it("blocks API/MCP write dispatch while allowing reads and cancel", async () => {
    const principal = { userId: person.id, tokenId: "test", scopes: [] };
    const run = vi.fn(async () => ({ ok: true }));
    const write = endpoint({ id: "test_write", method: "POST", path: "/test", scope: null, bucket: "write", tag: "Projects", summary: "Test", description: "Test", response: z.object({ ok: z.boolean() }), run });
    await expect(callEndpoint(principal, write, {})).rejects.toMatchObject({ status: 503 });
    expect(run).not.toHaveBeenCalled();
    await expect(callEndpoint(principal, { ...write, method: "GET", readOnly: true }, {})).resolves.toEqual({ ok: true });
    await expect(callEndpoint(principal, { ...write, id: "cancel_deployment" }, {})).resolves.toEqual({ ok: true });
    await expect(callEndpoint({ ...principal, userId: admin.id }, write, {})).resolves.toEqual({ ok: true });
    await saveMaintenance(admin.id, { enabled: false, message: "" });
    await expect(callEndpoint(principal, write, {})).resolves.toEqual({ ok: true });
  });
  it("does not let an admin browser cookie override an ordinary bearer identity", async () => {
    await saveMaintenance(admin.id, { enabled: true, message: "Upgrading" });
    const token = await createApiToken(person.id, { name: "Ordinary", scopes: ["webhooks:write"] });
    vi.mocked(getCurrentUser).mockResolvedValue(admin);
    const route = handle(async () => ok({ ran: true }), { skipOriginCheck: true });
    const request = new NextRequest("http://localhost:3000/api/v1/webhooks", { method: "POST", headers: { authorization: `Bearer ${token.secret}`, cookie: "egg_session=admin-cookie" } });
    expect((await route(request, undefined)).status).toBe(503);
  });
  it("keeps administration endpoints restricted to the exact configured account", async () => {
    await expect(adminOverview(person.id)).rejects.toMatchObject({ status: 403 });
    vi.mocked(getCurrentUser).mockResolvedValue(person);
    const response = await saveRoute(new NextRequest("http://localhost:3000/api/admin/maintenance", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) }), undefined);
    expect(response.status).toBe(403);
    expect((await maintenanceState()).active).toBe(true);
    vi.mocked(getCurrentUser).mockResolvedValue(admin);
    expect((await adminOverview(admin.id)).users).toBe(2);
    await saveMaintenance(admin.id, { enabled: false });
  });
});

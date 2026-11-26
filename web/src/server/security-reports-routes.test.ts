import { NextRequest } from "next/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { useFreshDb } from "@/server/test/db";
import { rateLimiter } from "@/server/rate-limit";
import { schema } from "@/server/db";
import { upsertUser } from "@/server/auth/session";
import { createWebhook } from "@/server/webhooks";
import {
  createSecurityReport,
  pruneWebhookDeliveries,
  REPORT_BODY_LIMIT,
  resetDeliveryPruneForTests,
} from "@/server/security-reports";
vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn() }));
import { getCurrentUser } from "@/server/auth/current";
import { POST, GLOBAL_REPORTER_KEY, GLOBAL_REPORTER_LIMIT, PER_REPORTER_LIMIT } from "@/app/api/security-reports/route";
import { GET as list } from "@/app/api/admin/security-reports/route";
import { GET as read } from "@/app/api/admin/security-reports/[id]/route";
import { GET as evidence } from "@/app/api/admin/security-reports/[id]/evidence/[index]/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
const raw = {
  title: "Private issue",
  details: "Steps to reproduce a private issue.",
  impact: "Private account details can leak.",
  anonymous: true,
};
beforeAll(async () => {
  ctx = await useFreshDb();
  process.env.SECURITY_REPORT_ADMIN_ID = "admin-id";
});
afterAll(async () => {
  delete process.env.SECURITY_REPORT_ADMIN_ID;
  await ctx.cleanup();
});
beforeEach(() => {
  rateLimiter().clear();
  resetDeliveryPruneForTests();
  vi.mocked(getCurrentUser).mockResolvedValue(null);
});
afterEach(() => {
  delete process.env.TRUST_PROXY;
});
const reporter = (id: string) => ({ id, name: "Reporter", email: null, hackClubId: `hc-${id}` });
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/security-reports", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });

describe("security reporting route boundaries", () => {
  it("refuses a report from a signed-out visitor and stores nothing", async () => {
    const res = await POST(req(raw), undefined);
    expect(res.status).toBe(401);
    const rows = await ctx.db.select({ id: schema.securityReports.id }).from(schema.securityReports);
    expect(rows).toHaveLength(0);
  });

  it("accepts a signed-in anonymous report and keeps no account link or address", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(reporter("reporter-anon") as never);
    const res = await POST(req(raw), undefined);
    expect(res.status).toBe(201);
    expect(Object.keys(await res.json())).toEqual(["reference"]);
    const links = await ctx.db
      .select({ target: schema.auditLog.target })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "security_report.source"));
    expect(links).toHaveLength(0);
  });

  it("bounds incoming bytes, then caps each account separately", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(reporter("reporter-a") as never);
    expect((await POST(req(raw, { "content-length": String(REPORT_BODY_LIMIT + 1) }), undefined)).status).toBe(413);
    rateLimiter().clear();
    for (let i = 0; i < PER_REPORTER_LIMIT; i++)
      expect((await POST(req(raw), undefined)).status).toBe(201);
    // One account cannot keep the inbox to itself, while another account gets its own allowance.
    expect((await POST(req(raw), undefined)).status).toBe(429);
    vi.mocked(getCurrentUser).mockResolvedValue(reporter("reporter-b") as never);
    expect((await POST(req(raw), undefined)).status).toBe(201);
  });

  it("bounds the total across accounts with a high aggregate ceiling", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(reporter("reporter-c") as never);
    const limiter = rateLimiter();
    for (let i = 0; i < GLOBAL_REPORTER_LIMIT; i++)
      limiter.check(GLOBAL_REPORTER_KEY, GLOBAL_REPORTER_LIMIT, 60 * 60_000);
    expect((await POST(req(raw), undefined)).status).toBe(429);
  });

  it("prunes old webhook deliveries from the scheduled maintenance path", async () => {
    const user = await upsertUser({ id: "prune-user", name: "Prune", email: null, slackId: null });
    const { webhook } = await createWebhook(user.id, { url: "https://example.test/hook" });
    const now = new Date("2026-03-01T00:00:00Z");
    const day = 86_400_000;
    await ctx.db.insert(schema.webhookDeliveries).values([
      { id: "stale-delivery", webhookId: webhook.id, event: "deployment.succeeded", status: "success", attempts: 1, createdAt: new Date(now.getTime() - 31 * day) },
      { id: "fresh-delivery", webhookId: webhook.id, event: "deployment.succeeded", status: "success", attempts: 1, createdAt: new Date(now.getTime() - day) },
    ]);
    expect(await pruneWebhookDeliveries(now)).toBe(true);
    const ids = (await ctx.db.select({ id: schema.webhookDeliveries.id }).from(schema.webhookDeliveries)).map((r) => r.id);
    expect(ids).toEqual(["fresh-delivery"]);
  });
  it("blocks cross-site submissions", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(reporter("reporter-d") as never);
    expect(
      (await POST(req(raw, { origin: "https://evil.example" }), undefined))
        .status,
    ).toBe(403);
  });
  it("never exposes report content to anonymous or non-admin users", async () => {
    const id = await createSecurityReport(raw);
    const request = new NextRequest(
      "http://localhost:3000/api/admin/security-reports",
    );
    expect((await list(request, undefined)).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "other",
      hackClubId: "other",
      name: "Admin",
      email: "admin@example.test",
    });
    expect((await list(request, undefined)).status).toBe(403);
    expect(
      (await read(request, { params: Promise.resolve({ id }) })).status,
    ).toBe(403);
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "admin-id",
      hackClubId: "admin",
      name: "Owner",
      email: null,
    });
    const res = await read(request, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await res.json()).payload.details).toBe(raw.details);
  });
  it("serves validated evidence only to the admin as a private inert download", async () => {
    const data =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ7kAAAAASUVORK5CYII=";
    const id = await createSecurityReport({
      ...raw,
      evidence: [{ name: "screen.png", type: "image/png", data }],
    });
    const request = new NextRequest(
      "http://localhost:3000/api/admin/security-reports/evidence",
    );
    const params = { params: Promise.resolve({ id, index: "0" }) };
    expect((await evidence(request, params)).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "admin-id",
      hackClubId: "admin",
      name: "Owner",
      email: null,
    });
    const res = await evidence(request, params);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).toString("base64")).toBe(data);
  });
});

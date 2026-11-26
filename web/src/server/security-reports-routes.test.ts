import { NextRequest } from "next/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { useFreshDb } from "@/server/test/db";
import { rateLimiter } from "@/server/rate-limit";
import {
  createSecurityReport,
  REPORT_BODY_LIMIT,
} from "@/server/security-reports";
vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn() }));
import { getCurrentUser } from "@/server/auth/current";
import { POST } from "@/app/api/security-reports/route";
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
  vi.mocked(getCurrentUser).mockResolvedValue(null);
});
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/security-reports", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });

describe("security reporting route boundaries", () => {
  it("accepts anonymous reports without consulting the signed-in identity", async () => {
    const res = await POST(req(raw), undefined);
    expect(res.status).toBe(201);
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(Object.keys(await res.json())).toEqual(["reference"]);
  });
  it("bounds incoming bytes and applies a shared limit when no peer address is trusted", async () => {
    expect(
      (
        await POST(
          req(raw, { "content-length": String(REPORT_BODY_LIMIT + 1) }),
          undefined,
        )
      ).status,
    ).toBe(413);
    rateLimiter().clear();
    for (let i = 0; i < 3; i++)
      expect((await POST(req(raw), undefined)).status).toBe(201);
    expect((await POST(req(raw), undefined)).status).toBe(429);
  });
  it("blocks cross-site submissions", async () => {
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

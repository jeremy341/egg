import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESS_SESSION_COOKIE, hashAccessPassword, issueAccessSession } from "@/server/access-protection";
import { resolveIngressProtection, verifyIngressRequest } from "@/server/ingress-protection";
import { getDb } from "@/server/db";

vi.mock("@/server/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/db")>(),
  getDb: vi.fn(),
}));
const mockedGetDb = vi.mocked(getDb);
const configRow = (config: unknown) => ({ config_json: JSON.stringify(config) });

function dbReturning(row: unknown) {
  mockedGetDb.mockResolvedValue({ run: vi.fn(), get: vi.fn().mockResolvedValue(row) } as never);
}

afterEach(() => vi.resetAllMocks());

describe("resolveIngressProtection", () => {
  it("resolves a host to a valid custom domain's project configuration", async () => {
    dbReturning({ project_id: "p1", config_json: JSON.stringify({ mode: "egg", excludedPaths: ["/health"] }) });
    await expect(resolveIngressProtection("APP.Example.com.")).resolves.toEqual({ projectId: "p1", mode: "egg", excludedPaths: ["/health"] });
  });

  it("returns null for unknown hosts and treats projects without settings as open", async () => {
    dbReturning(null);
    await expect(resolveIngressProtection("unknown.example.com")).resolves.toBeNull();
    dbReturning({ project_id: "p1", config_json: null });
    await expect(resolveIngressProtection("", "p1")).resolves.toEqual({ projectId: "p1", mode: "off", excludedPaths: [] });
  });
});

describe("verifyIngressRequest", () => {
  it("accepts the configured shared password and rejects incorrect credentials", async () => {
    const passwordHash = await hashAccessPassword("a-long-enough-project-password");
    dbReturning(configRow({ mode: "password", passwordHash, excludedPaths: [] }));
    const protection = { projectId: "p1", mode: "password" as const, excludedPaths: [] };
    const good = new Request("https://app.example.com/", { headers: { "x-egg-access-password": "a-long-enough-project-password" } });
    const bad = new Request("https://app.example.com/", { headers: { "x-egg-access-password": "incorrect" } });
    await expect(verifyIngressRequest(good, protection)).resolves.toBe(true);
    await expect(verifyIngressRequest(bad, protection)).resolves.toBe(false);
  });

  it("checks standard Basic credentials and the project-scoped Egg cookie", async () => {
    const passwordHash = await hashAccessPassword("a-long-enough-project-password");
    dbReturning(configRow({ mode: "basic-auth", username: "deploy", passwordHash, excludedPaths: [] }));
    const basicProtection = { projectId: "p1", mode: "basic-auth" as const, excludedPaths: [] };
    const basic = new Request("https://app.example.com/", { headers: { authorization: `Basic ${Buffer.from("deploy:a-long-enough-project-password").toString("base64")}` } });
    await expect(verifyIngressRequest(basic, basicProtection)).resolves.toBe(true);
    vi.stubEnv("APP_SECRET", "test-secret-with-at-least-thirty-two-characters");
    const token = issueAccessSession("p1", "viewer");
    const egg = new Request("https://app.example.com/", { headers: { cookie: `${ACCESS_SESSION_COOKIE}=${token}` } });
    await expect(verifyIngressRequest(egg, { projectId: "p1", mode: "egg", excludedPaths: [] })).resolves.toBe(true);
    await expect(verifyIngressRequest(egg, { projectId: "p2", mode: "egg", excludedPaths: [] })).resolves.toBe(false);
  });

  it("allows excluded paths and open projects without credentials", async () => {
    const request = new Request("https://app.example.com/health?ready=1");
    await expect(verifyIngressRequest(request, { projectId: "p1", mode: "password", excludedPaths: ["/health"] })).resolves.toBe(true);
    await expect(verifyIngressRequest(request, { projectId: "p1", mode: "off", excludedPaths: [] })).resolves.toBe(true);
  });
});

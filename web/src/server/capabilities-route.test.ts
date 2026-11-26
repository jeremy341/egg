import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/servers", () => ({ getServerForUser: vi.fn(), withServerSession: vi.fn() }));
vi.mock("@/server/capabilities", () => ({ probeTargetCapabilities: vi.fn() }));
import { getCurrentUser } from "@/server/auth/current";
import { getServerForUser, withServerSession } from "@/server/servers";
import { probeTargetCapabilities } from "@/server/capabilities";
import { GET } from "@/app/api/servers/[id]/capabilities/route";

describe("server capabilities route", () => {
  it("requires authentication before looking up or connecting to a server", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const response = await GET(new NextRequest("http://localhost/api/servers/s/capabilities"), { params: Promise.resolve({ id: "s" }) });
    expect(response.status).toBe(401);
    expect(getServerForUser).not.toHaveBeenCalled();
  });
  it("checks ownership before probing and returns the capability object", async () => {
    const user = { id: "u", name: "U", email: null, hackClubId: "h" };
    vi.mocked(getCurrentUser).mockResolvedValueOnce(user);
    vi.mocked(getServerForUser).mockResolvedValueOnce({ id: "s" } as never);
    vi.mocked(withServerSession).mockImplementationOnce(async (_server, fn) => fn({} as never));
    const capabilities = { deploymentModes: { native: true, dockerfile: false, compose: false }, docker: { available: false, composeAvailable: false, reason: "unverified" }, runtimes: ["node"] };
    vi.mocked(probeTargetCapabilities).mockResolvedValueOnce(capabilities);
    const response = await GET(new NextRequest("http://localhost/api/servers/s/capabilities"), { params: Promise.resolve({ id: "s" }) });
    expect(getServerForUser).toHaveBeenCalledWith("u", "s");
    expect(await response.json()).toEqual(capabilities);
  });
});

it("does not connect when the server lookup denies access", async () => {
  const user = { id: "other", name: "Other", email: null, hackClubId: "h" };
  vi.mocked(getCurrentUser).mockResolvedValueOnce(user);
  vi.mocked(withServerSession).mockClear();
  const { HttpError } = await import("@/server/http");
  vi.mocked(getServerForUser).mockRejectedValueOnce(new HttpError(404, "Server not found"));
  const response = await GET(new NextRequest("http://localhost/api/servers/s/capabilities"), { params: Promise.resolve({ id: "s" }) });
  expect(response.status).toBe(404);
  expect(withServerSession).not.toHaveBeenCalled();
});

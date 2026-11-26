import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ user: null as string | null, owner: false }));
vi.mock("@/server/http", () => ({ authed: async () => { if (!auth.user) throw new Error("unauthorized"); return { id: auth.user }; }, handle: (fn: unknown) => fn, ok: (data: unknown) => data }));
vi.mock("@/server/projects", () => ({ readableDeployment: async () => { if (!auth.owner) throw new Error("not found"); return { dep: { id: "d", projectId: "p", env: "production", createdAt: new Date() } }; } }));
vi.mock("@/server/deploy/performance-report", () => ({ performanceReport: vi.fn(async () => ({ stages: [] })) }));
import { GET } from "@/app/api/deployments/[id]/performance/route";
import { performanceReport } from "./performance-report";
beforeEach(() => { auth.user = null; auth.owner = false; vi.clearAllMocks(); });
it("requires authentication before reading a report", async () => {
  await expect(GET({} as never, { params: Promise.resolve({ id: "d" }) })).rejects.toThrow("unauthorized");
  expect(performanceReport).not.toHaveBeenCalled();
});
it("refuses a deployment outside the owner account", async () => {
  auth.user = "other";
  await expect(GET({} as never, { params: Promise.resolve({ id: "d" }) })).rejects.toThrow("not found");
  expect(performanceReport).not.toHaveBeenCalled();
});

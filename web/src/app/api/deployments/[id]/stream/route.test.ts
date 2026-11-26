import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDeploymentStreams } from "@/server/deployment-streams";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  readable: vi.fn(),
  logs: vi.fn(),
  state: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/server/http", () => ({
  authed: async () => ({ id: "u" }),
  handle: (fn: unknown) => fn,
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string, public code: string, public headers?: Record<string, string>) {
      super(message);
    }
  },
}));
vi.mock("@/server/auth/session", () => ({
  SESSION_COOKIE: "egg_session",
  userForSessionToken: mocks.auth,
}));
vi.mock("@/server/projects", () => ({
  deploymentLogs: mocks.logs,
  readableDeployment: mocks.readable,
}));
vi.mock("@/server/db", () => ({
  schema: { deployments: { id: "id", state: "state", error: "error", projectId: "project_id" } },
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: (predicate: unknown) => {
          mocks.where(predicate);
          return { get: mocks.state };
        },
      }),
    }),
  }),
}));

import { GET } from "@/app/api/deployments/[id]/stream/route";

const open = () =>
  GET(new NextRequest("http://localhost/api/deployments/d/stream", {
    headers: { cookie: "egg_session=token" },
  }), { params: Promise.resolve({ id: "d" }) });

const logPage = (count: number) => Array.from({ length: count }, (_, i) => ({
  id: i + 1, at: "now", level: "info", message: "x",
}));

/** Collect the literal SQL chunks of a drizzle predicate, without executing it. */
const sqlText = (chunk: unknown): string => {
  if (typeof chunk === "string") return chunk;
  if (!chunk || typeof chunk !== "object") return "";
  const value = chunk as { queryChunks?: unknown[]; value?: unknown };
  if (Array.isArray(value.queryChunks)) return value.queryChunks.map(sqlText).join("");
  // drizzle stores StringChunk text as an array of string fragments.
  if (Array.isArray(value.value)) return value.value.map(sqlText).join("");
  return typeof value.value === "string" ? value.value : "";
};

beforeEach(() => {
  resetDeploymentStreams();
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ id: "u" });
  mocks.readable.mockResolvedValue({});
  mocks.logs.mockResolvedValue([]);
  mocks.state.mockResolvedValue({ state: "ready", error: null });
});

describe("deployment stream authorization", () => {
  it("re-checks readableDeployment before emitting each buffered line", async () => {
    let calls = 0;
    mocks.readable.mockImplementation(async () => {
      // handler check, iteration that fetches the page, iteration that emits the
      // first line, then revocation before the next buffered line.
      if (++calls === 4) throw new Error("access revoked");
      return {};
    });
    mocks.logs.mockResolvedValue(logPage(3));

    const body = await (await open()).text();
    expect(body.match(/event: log/g)).toHaveLength(1);
    expect(body).not.toContain("event: state");
  });

  it("re-checks readableDeployment before reading terminal state", async () => {
    let calls = 0;
    mocks.readable.mockImplementation(async () => {
      // The page is empty, so the first iteration reads the terminal state and
      // the next one would emit it. Revoke access in between.
      if (++calls === 3) throw new Error("access revoked");
      return {};
    });
    mocks.state.mockResolvedValue({ state: "ready", error: null });

    const body = await (await open()).text();
    expect(body).not.toContain("event: state");
  });

  it("still emits a terminal state while access remains valid", async () => {
    const body = await (await open()).text();
    expect(body).toContain("event: state");
    expect(body).toContain('"state":"ready"');
  });

  it("scopes the state query to the project owner", async () => {
    await (await open()).text();
    const predicates = mocks.where.mock.calls.map((call) => call[0]);
    expect(predicates.length).toBeGreaterThan(0);
    const scoped = predicates.some((predicate) => {
      const text = sqlText(predicate);
      return text.includes("exists") && text.includes("user_id");
    });
    expect(scoped).toBe(true);
  });
});

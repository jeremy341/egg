import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";

vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));

import { getCurrentUser } from "@/server/auth/current";
import { createServer } from "@/server/servers";
import { GET, PUT } from "@/app/api/servers/[id]/build-memory/route";

const ORIGIN = "http://localhost:3000";
const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (id: string, body: unknown) =>
  PUT(
    new NextRequest(`${ORIGIN}/x`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
    }),
    ctxOf(id)
  );
const get = (id: string) => GET(new NextRequest(`${ORIGIN}/x`), ctxOf(id));
type Body = {
  buildMemory?: { memoryMb: number; minMb: number; maxMb: number; defaultMb: number };
  buildCpu?: { cpuCores: number; minCpus: number; maxCpus: number; defaultCpus: number; step: number };
};
const read = async (res: Response) => (await res.json()) as Body;

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let sam: { id: string };
let kim: { id: string };
let a: string;
let b: string;
let kimServer: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  // Stands in for the generated migration until it exists. Harmless once the column is there.
  try {
    await ctx.db.run(sql`ALTER TABLE servers ADD COLUMN build_memory_mb integer DEFAULT 2048 NOT NULL`);
  } catch {
    /* the migration already added it */
  }
  try {
    await ctx.db.run(sql`ALTER TABLE servers ADD COLUMN build_cpu_quarters integer DEFAULT 8 NOT NULL`);
  } catch {
    /* the migration already added it */
  }
  sam = await upsertUser({ id: "bm1", name: "Sam", email: null, slackId: null });
  kim = await upsertUser({ id: "bm2", name: "Kim", email: null, slackId: null });
  a = (await createServer(sam.id, "sam-a")).id;
  b = (await createServer(sam.id, "sam-b")).id;
  kimServer = (await createServer(kim.id, "kim-a")).id;
});
afterAll(async () => {
  await ctx.cleanup();
});
beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue(sam as never);
});

describe("build memory setting", () => {
  it("starts at 512 MB on a new server, with the 512 to 8192 range when no memory was reported", async () => {
    const res = await read(await get(a));
    expect(res.buildMemory).toEqual({ memoryMb: 512, minMb: 512, maxMb: 8192, defaultMb: 512 });
  });

  it("is per server: changing one leaves the other alone", async () => {
    expect((await put(a, { memoryMb: 4096 })).status).toBe(200);
    expect((await read(await get(a))).buildMemory?.memoryMb).toBe(4096);
    expect((await read(await get(b))).buildMemory?.memoryMb).toBe(512);
    const rows = await ctx.db.select().from(schema.servers).where(eq(schema.servers.userId, sam.id));
    expect(Object.fromEntries(rows.map((r) => [r.nestUsername, r.buildMemoryMb]))).toEqual({
      "sam-a": 4096,
      "sam-b": 512,
    });
  });

  it("refuses a value outside the range or that is not a whole number", async () => {
    for (const memoryMb of [511, 8193, 1000.5, "4096", null]) {
      const res = await put(b, { memoryMb });
      expect(res.status, String(memoryMb)).toBe(400);
    }
    expect((await put(b, { memoryMb: 2048, other: 1 })).status).toBe(400);
    expect((await read(await get(b))).buildMemory?.memoryMb).toBe(512);
  });

  it("allows up to the total memory the probe reported", async () => {
    await ctx.db
      .update(schema.servers)
      .set({ probe: JSON.stringify({ memTotalMb: 16384 }) })
      .where(eq(schema.servers.id, b));
    expect((await read(await get(b))).buildMemory?.maxMb).toBe(16384);
    expect((await put(b, { memoryMb: 12000 })).status).toBe(200);
    expect((await put(b, { memoryMb: 16385 })).status).toBe(400);
    // The other server did not report memory, so it keeps the fallback top.
    expect((await put(a, { memoryMb: 12000 })).status).toBe(400);
  });

  it("is only for the owner", async () => {
    expect((await put(kimServer, { memoryMb: 1024 })).status).toBe(404);
    expect((await get(kimServer)).status).toBe(404);
    const row = await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, kimServer)).get();
    expect(row?.buildMemoryMb).toBe(512);
  });

  it("needs a signed-in user", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as never);
    expect((await put(a, { memoryMb: 1024 })).status).toBe(401);
  });
});

describe("build CPU setting", () => {
  it("defaults to two cores and adapts the effective default to smaller reported servers", async () => {
    expect((await read(await get(a))).buildCpu).toEqual({
      cpuCores: 2,
      minCpus: 0.5,
      maxCpus: 2,
      defaultCpus: 2,
      step: 0.25,
    });
    await ctx.db.update(schema.servers).set({ probe: JSON.stringify({ cpus: 1 }) }).where(eq(schema.servers.id, a));
    expect((await read(await get(a))).buildCpu).toEqual({
      cpuCores: 1,
      minCpus: 0.5,
      maxCpus: 1,
      defaultCpus: 1,
      step: 0.25,
    });
  });

  it("saves per-server quarter-core limits without changing other servers", async () => {
    await ctx.db.update(schema.servers).set({ probe: JSON.stringify({ cpus: 4 }) }).where(eq(schema.servers.id, a));
    expect((await put(a, { cpuCores: 1.25 })).status).toBe(200);
    expect((await read(await get(a))).buildCpu?.cpuCores).toBe(1.25);
    expect((await read(await get(b))).buildCpu?.cpuCores).toBe(2);
    const rows = await ctx.db.select().from(schema.servers).where(eq(schema.servers.userId, sam.id));
    expect(Object.fromEntries(rows.map((r) => [r.nestUsername, r.buildCpuQuarters]))).toEqual({
      "sam-a": 5,
      "sam-b": 8,
    });
  });

  it("refuses values outside the target capacity, off the quarter-core step, or with extra keys", async () => {
    await ctx.db.update(schema.servers).set({ probe: JSON.stringify({ cpus: 2 }) }).where(eq(schema.servers.id, b));
    for (const cpuCores of [0.25, 2.25, 1.1, "1.5", null]) {
      expect((await put(b, { cpuCores })).status).toBe(400);
    }
    expect((await put(b, { cpuCores: 1, other: 1 })).status).toBe(400);
    expect((await read(await get(b))).buildCpu?.cpuCores).toBe(2);
  });

  it("allows a valid fractional CPU setting only for the owner", async () => {
    expect((await put(kimServer, { cpuCores: 1.5 })).status).toBe(404);
    vi.mocked(getCurrentUser).mockResolvedValue(null as never);
    expect((await put(a, { cpuCores: 1.5 })).status).toBe(401);
  });
});

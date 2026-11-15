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
type Body = { buildMemory?: { memoryMb: number; minMb: number; maxMb: number; defaultMb: number } };
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
  it("starts at 2048 MB on a new server, with the 512 to 8192 range when no memory was reported", async () => {
    const res = await read(await get(a));
    expect(res.buildMemory).toEqual({ memoryMb: 2048, minMb: 512, maxMb: 8192, defaultMb: 2048 });
  });

  it("is per server: changing one leaves the other alone", async () => {
    expect((await put(a, { memoryMb: 4096 })).status).toBe(200);
    expect((await read(await get(a))).buildMemory?.memoryMb).toBe(4096);
    expect((await read(await get(b))).buildMemory?.memoryMb).toBe(2048);
    const rows = await ctx.db.select().from(schema.servers).where(eq(schema.servers.userId, sam.id));
    expect(Object.fromEntries(rows.map((r) => [r.nestUsername, r.buildMemoryMb]))).toEqual({
      "sam-a": 4096,
      "sam-b": 2048,
    });
  });

  it("refuses a value outside the range or that is not a whole number", async () => {
    for (const memoryMb of [511, 8193, 1000.5, "4096", null]) {
      const res = await put(b, { memoryMb });
      expect(res.status, String(memoryMb)).toBe(400);
    }
    expect((await put(b, { memoryMb: 1024, other: 1 })).status).toBe(400);
    expect((await read(await get(b))).buildMemory?.memoryMb).toBe(2048);
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
    expect(row?.buildMemoryMb).toBe(2048);
  });

  it("needs a signed-in user", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as never);
    expect((await put(a, { memoryMb: 1024 })).status).toBe(401);
  });
});

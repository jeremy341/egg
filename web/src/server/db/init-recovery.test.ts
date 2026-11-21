import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db";

const g = globalThis as unknown as { __eggDb?: unknown };
const original = g.__eggDb;

afterEach(() => {
  g.__eggDb = original;
});

describe("getDb failed-init recovery", () => {
  it("drops a holder whose ready rejected and closes its client so the next call can retry", async () => {
    let closed = false;
    g.__eggDb = {
      client: { close: () => { closed = true; } },
      db: {} as never,
      ready: Promise.reject(new Error("migration failed")),
    };

    await expect(getDb()).rejects.toThrow("migration failed");
    expect(closed).toBe(true);
    expect(g.__eggDb).toBeUndefined();
  });
});

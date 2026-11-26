import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { getDb, schema } from "@/server/db";

/** Coordinate idempotent background work across app/worker processes. */
export async function withMaintenanceLease<T>(name: string, work: () => Promise<T>, ttlMs = 60_000, cooldownMs = 0): Promise<T | null> {
  const db = await getDb();
  const startedAt = Date.now();
  const owner = randomUUID();
  const values = () => ({ name, owner, updatedAt: new Date(), expiresAt: new Date(Date.now() + ttlMs) });
  const acquired = await db.insert(schema.maintenanceLeases).values(values()).onConflictDoUpdate({
    target: schema.maintenanceLeases.name, set: values(), where: lte(schema.maintenanceLeases.expiresAt, new Date()),
  }).returning({ owner: schema.maintenanceLeases.owner });
  if (!acquired.length) return null;
  const timer = setInterval(() => {
    void db.update(schema.maintenanceLeases).set({ expiresAt: new Date(Date.now() + ttlMs), updatedAt: new Date() })
      .where(and(eq(schema.maintenanceLeases.name, name), eq(schema.maintenanceLeases.owner, owner))).catch(() => {});
  }, Math.max(1000, Math.floor(ttlMs / 3)));
  timer.unref?.();
  try { return await work(); }
  finally {
    clearInterval(timer);
    const mine = and(eq(schema.maintenanceLeases.name, name), eq(schema.maintenanceLeases.owner, owner));
    if (cooldownMs > 0) {
      await db.update(schema.maintenanceLeases).set({ expiresAt: new Date(Math.max(Date.now(), startedAt + cooldownMs)), updatedAt: new Date() }).where(mine);
    } else await db.delete(schema.maintenanceLeases).where(mine);
  }
}

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { formatMeta } from "@/server/activity";
import {
  createEnvironmentSet,
  deleteSharedEnvironmentVariables,
  mergeSharedEnvironmentVariables,
  replaceSharedEnvironmentVariables,
} from "@/server/shared-environments";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "shared-audit-user", name: "Sam", email: null, slackId: null })).id;
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("shared environment audit keys", () => {
  it("records replaced and removed names without values", async () => {
    const environment = await createEnvironmentSet(userId, { name: "Shared defaults" });
    await mergeSharedEnvironmentVariables(userId, environment.id, [
      { key: "OLD_KEY", value: "private-old-value", target: "all" },
      { key: "KEEP_KEY", value: "private-keep-value", target: "production" },
    ]);
    await ctx.db.delete(schema.auditLog);

    await replaceSharedEnvironmentVariables(userId, environment.id, "Shared defaults", [
      { key: "NEW_KEY", value: "private-new-value", target: "all" },
      { key: "KEEP_KEY", value: "private-new-keep-value", target: "production" },
    ]);
    const replaceAudit = await ctx.db.select().from(schema.auditLog)
      .where(eq(schema.auditLog.action, "env.sets.variables.replace")).get();
    const replaceMeta = JSON.parse(replaceAudit!.meta!) as Record<string, string>;
    expect(replaceMeta.keys).toBe("KEEP_KEY, NEW_KEY, OLD_KEY");
    expect(formatMeta("env.sets.variables.replace", replaceMeta).fields).toContainEqual({
      label: "Variables",
      value: "KEEP_KEY, NEW_KEY, OLD_KEY",
      mono: false,
    });
    expect(replaceAudit?.meta).not.toContain("private-");

    await ctx.db.delete(schema.auditLog);
    await deleteSharedEnvironmentVariables(userId, environment.id, "Shared defaults", { keys: ["NEW_KEY"] });
    const deleteAudit = await ctx.db.select().from(schema.auditLog)
      .where(eq(schema.auditLog.action, "env.sets.variables.delete")).get();
    const deleteMeta = JSON.parse(deleteAudit!.meta!) as Record<string, string>;
    expect(deleteMeta.keys).toBe("NEW_KEY");
    expect(formatMeta("env.sets.variables.delete", deleteMeta).fields).toContainEqual({
      label: "Variables",
      value: "NEW_KEY",
      mono: false,
    });
    expect(deleteAudit?.meta).not.toContain("private-");
  });
});

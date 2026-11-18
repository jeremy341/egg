import { authed, handle, HttpError, ok } from "@/server/http";
import { isInstanceAdmin } from "@/server/admin-identity";
import { backendMetricsSnapshot } from "@/server/backend-metrics";
import { getDb, schema } from "@/server/db";
import { count } from "drizzle-orm";

export const GET = handle(async () => {
  const user = await authed();
  if (!(await isInstanceAdmin(user.id))) throw new HttpError(403, "Only an instance administrator can read diagnostics.", "forbidden");
  const db = await getDb();
  const queue = await db.select({ state: schema.jobs.state, count: count() }).from(schema.jobs).groupBy(schema.jobs.state);
  const res = ok({ ...backendMetricsSnapshot(), queue, configuration: { enableMetrics: "EGG_BACKEND_METRICS=1" } });
  res.headers.set("Cache-Control", "no-store"); return res;
});

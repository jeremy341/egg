import { authed, HttpError, handle, ok } from "@/server/http";
import { parseMetricsRange } from "@/lib/statistics-metrics";
import { projectStatisticsMetrics } from "@/server/statistics-metrics";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Daily series for the statistics switched on for a project. `?range=` is 7d,
 * 30d (the default) or 90d. Anyone who can view the project may read it.
 */
export const GET = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const range = parseMetricsRange(new URL(req.url).searchParams.get("range"));
  if (!range) throw new HttpError(400, "range must be 7d, 30d or 90d", "validation");
  return ok(await projectStatisticsMetrics(user.id, id, range));
});

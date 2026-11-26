import { authed, handle, ok, readJson } from "@/server/http";
import { getStatisticsForUser, statisticsPatch, updateStatistics } from "@/server/statistics";

type Ctx = { params: Promise<{ id: string }> };

/** The statistics switches for a project the person owns. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok({ statistics: await getStatisticsForUser(user.id, id) });
});

/** Switch statistics on or off. Unknown keys are refused. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const patch = await readJson(req, statisticsPatch);
  return ok({ statistics: await updateStatistics(user.id, id, patch) });
});

import { authed, handle, ok } from "@/server/http";
import { fetchJobLogs } from "@/server/scheduled-jobs";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id, jobId } = await params;
  return ok({ lines: await fetchJobLogs(user.id, id, jobId) });
});

import { authed, handle, ok } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { fetchJobLogs } from "@/server/scheduled-jobs";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  // Reading job logs runs a script over SSH, so it shares the slow-call bucket.
  enforceRateLimit("sshCall", user.id);
  enforceRateLimit("sshSession", user.id);
  const { id, jobId } = await params;
  return ok({ lines: await fetchJobLogs(user.id, id, jobId) });
});

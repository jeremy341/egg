import { authed, handle, ok } from "@/server/http";
import { runJob } from "@/server/scheduled-jobs";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

/** Start the job once now. It runs in the background; read its output from the logs. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id, jobId } = await params;
  await runJob(user.id, id, jobId);
  return ok({ ok: true }, 202);
});

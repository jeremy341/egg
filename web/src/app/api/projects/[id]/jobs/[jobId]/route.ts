import { readJsonLimited } from "@/server/body-limit";
import { authed, handle, ok } from "@/server/http";
import { deleteJob, updateJob } from "@/server/scheduled-jobs";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id, jobId } = await params;
  return ok({ job: await updateJob(user.id, id, jobId, await readJsonLimited(req, { fallback: {} })) });
});

export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id, jobId } = await params;
  await deleteJob(user.id, id, jobId);
  return ok({ ok: true });
});

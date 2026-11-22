import { readJsonLimited } from "@/server/body-limit";
import { authed, handle, ok } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { createJob, fetchJobStatuses, listJobs } from "@/server/scheduled-jobs";

type Ctx = { params: Promise<{ id: string }> };

/** The project's jobs. With `?status=1` it also asks the container how each one is doing. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const jobs = await listJobs(user.id, id);
  if (new URL(req.url).searchParams.get("status") === "1") {
    // `status=1` queries the container over SSH, so it shares the slow-call bucket.
    enforceRateLimit("sshCall", user.id);
    enforceRateLimit("sshSession", user.id);
    return ok({ jobs, status: await fetchJobStatuses(user.id, id) });
  }
  return ok({ jobs });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok({ job: await createJob(user.id, id, await readJsonLimited(req, { fallback: {} })) }, 201);
});

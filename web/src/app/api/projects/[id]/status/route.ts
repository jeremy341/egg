import { authed, handle, ok } from "@/server/http";
import { lastKnownServiceStatus } from "@/server/service-status";

type Ctx = { params: Promise<{ id: string }> };

/**
 * State of the production service, read over SSH. A reading under 30 seconds
 * old is reused, and `status.checkedAt` says when it was taken. `?fresh=1`
 * (the Check now button) always asks the container.
 */
export const GET = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const { status, cached } = await lastKnownServiceStatus(user.id, id, { fresh });
  return ok({ status, cached });
});

import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { changeErrorGroup } from "@/server/error-groups";
import { ERROR_GROUP_ACTIONS } from "@/lib/error-status";
import { enforceRateLimit } from "@/server/rate-limit";

type Ctx = { params: Promise<{ id: string; fingerprint: string }> };

const body = z.object({
  action: z.enum(ERROR_GROUP_ACTIONS),
  /** Only for `assign`: a project member's user id, or null to unassign. */
  assigneeId: z.string().min(1).max(64).nullable().optional(),
});

/** Resolve, reopen, ignore or assign one error group. Owner only. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id, fingerprint } = await params;
  enforceRateLimit("errorTriage", user.id);
  const input = await readJson(req, body);
  const result = await changeErrorGroup(user.id, id, fingerprint, input.action, input.assigneeId ?? null);
  return ok(result);
});

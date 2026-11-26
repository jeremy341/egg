import { authed, handle, ok } from "@/server/http";
import { errorGroups } from "@/server/error-groups";
import { parseErrorGroupStatus } from "@/lib/error-status";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Error groups of a project for the last `days` days (default 30, up to 90),
 * filtered by `status` (open, resolved, ignored or all).
 */
export const GET = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const n = Number(sp.get("days") ?? 30);
  const days = Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 1), 90) : 30;
  const status = parseErrorGroupStatus(sp.get("status"));
  const groups = await errorGroups(user.id, id, days);
  return ok({ groups: status === "all" ? groups : groups.filter((g) => g.status === status) });
});

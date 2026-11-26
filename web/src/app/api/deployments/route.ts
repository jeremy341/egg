import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  parseEnv,
  parseRange,
  parseStatus,
} from "@/server/deployment-page";
import { authed, handle, HttpError, ok } from "@/server/http";
import { listDeploymentsPage } from "@/server/projects";

/**
 * Query: `project`, `limit` (default 25, at most 100), `cursor` (the
 * `nextCursor` of the page before), and the filters `status`, `env`, `range`
 * and `q`. Answers `{ deployments, nextCursor }`; `nextCursor` is null on the last page.
 */
export const GET = handle(async (req) => {
  const user = await authed();
  const params = req.nextUrl.searchParams;
  const cursor = params.get("cursor");
  if (cursor && !decodeCursor(cursor)) throw new HttpError(400, "That cursor is not valid.", "bad_cursor");
  const { rows, nextCursor } = await listDeploymentsPage(user.id, {
    projectId: params.get("project") ?? undefined,
    limit: params.has("limit") ? Number(params.get("limit")) : DEFAULT_PAGE_SIZE,
    cursor,
    filter: {
      status: parseStatus(params.get("status")),
      env: parseEnv(params.get("env")),
      range: parseRange(params.get("range")),
      q: params.get("q")?.slice(0, 300) ?? undefined,
    },
  });
  return ok({
    deployments: rows.map((r) => ({
      ...r.deployment,
      projectName: r.projectName,
      projectSlug: r.projectSlug,
    })),
    nextCursor,
  });
});

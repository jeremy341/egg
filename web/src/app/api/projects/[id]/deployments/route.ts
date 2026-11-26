import { decodeCursor, parseEnv, parseRange, parseStatus } from "@/server/deployment-page";
import { authed, handle, HttpError, ok } from "@/server/http";
import { getReadableProject } from "@/server/projects";
import { deploymentPage } from "@/server/queries";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One page of a project's deployments as the list shows them, newest first.
 * Query: `cursor`, `limit` (default 25, at most 100), `status`, `env`, `range`, `q`.
 * Answers `{ deployments, nextCursor }`. 404 unless the project is yours.
 */
export const GET = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  await getReadableProject(user.id, id);
  const q = req.nextUrl.searchParams;
  const cursor = q.get("cursor");
  if (cursor && !decodeCursor(cursor)) throw new HttpError(400, "That cursor is not valid.", "bad_cursor");
  const { rows, nextCursor } = await deploymentPage(user.id, {
    projectId: id,
    cursor,
    limit: q.has("limit") ? Number(q.get("limit")) : undefined,
    filter: {
      status: parseStatus(q.get("status")),
      env: parseEnv(q.get("env")),
      range: parseRange(q.get("range")),
      q: q.get("q")?.slice(0, 300) ?? undefined,
    },
  });
  return ok({ deployments: rows.map((row) => ({ ...row, port: row.port === 0 ? null : row.port })), nextCursor });
});

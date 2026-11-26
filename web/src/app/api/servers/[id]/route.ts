import { HttpError, authed, handle, ok, zodToHttp } from "@/server/http";
import { deleteServer, disconnectBody, getServerForUser, publicServer } from "@/server/servers";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok({ server: publicServer(await getServerForUser(user.id, id)) });
});

/**
 * Disconnect a server. The body is optional: `{ "deleteProjects": true }` also
 * deletes the projects on it. Without it the projects are kept.
 */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const raw = await req.text();
  let parsed: unknown = {};
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Request body must be JSON", "bad_json");
    }
  }
  const result = disconnectBody.safeParse(parsed);
  if (!result.success) throw zodToHttp(result.error);
  await deleteServer(user.id, id, result.data);
  return ok({ ok: true });
});

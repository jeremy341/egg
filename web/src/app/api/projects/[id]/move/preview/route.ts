import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { previewProjectMove } from "@/server/project-move";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Step one of a move: what would change, and a digest to confirm against.
 * Nothing is changed by this call. `toOrgId` null means "make it personal".
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const body = await readJson(req, z.object({ toOrgId: z.string().min(1).max(64).nullable() }));
  return ok({ preview: await previewProjectMove(user.id, id, body.toOrgId) });
});

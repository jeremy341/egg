import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { confirmProjectMove } from "@/server/project-move";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Step two: apply the move, but only with the digest from the preview. Any
 * change since the preview (a member, an org role, the target) refuses it.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const body = await readJson(
    req,
    z.object({ toOrgId: z.string().min(1).max(64).nullable(), digest: z.string().regex(/^[0-9a-f]{64}$/) })
  );
  return ok({ move: await confirmProjectMove(user.id, id, body.toOrgId, body.digest) });
});

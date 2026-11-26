import { authed, handle, ok } from "@/server/http";
import { projectRightSize } from "@/server/queries";

type Ctx = { params: Promise<{ id: string }> };

/** The resource suggestion for the project's service, from the monitor's samples. Nothing is applied. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok({ suggestion: await projectRightSize(user.id, id) });
});

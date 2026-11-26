import { authed, handle, ok } from "@/server/http";
import { securityChecksForProject } from "@/server/deploy/security-checks";

type Ctx = { params: Promise<{ id: string }> };

/** Read-only security findings for the signed-in project's owner. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok({ findings: await securityChecksForProject(user.id, id) });
});

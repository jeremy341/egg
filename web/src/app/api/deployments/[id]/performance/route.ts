import { authed, handle, ok } from "@/server/http";
import { ownedDeployment } from "@/server/projects";
import { performanceReport } from "@/server/deploy/performance-report";
type Ctx = { params: Promise<{ id: string }> };
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const { dep } = await ownedDeployment(user.id, id);
  return ok(await performanceReport(dep));
});

import { NextResponse } from "next/server";
import { publishWorkflow } from "@/server/builds/workflow-publish";
import { authed, handle } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Open the pull request that adds the Egg build workflow to this project's repository. Owner only. It makes GitHub
 * write requests with the app's installation token, so it is limited per user. The answer has the status, the
 * branch, the base branch and the pull request link; it never contains a token or the contents of the file.
 */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  enforceRateLimit("workflowPublish", user.id);
  const result = await publishWorkflow(user.id, id);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
});

import { NextResponse } from "next/server";
import { checkGithubConnection } from "@/server/builds/connection-check";
import { config } from "@/server/config";
import { authed, handle } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

/**
 * "Test connection" for a project that builds on GitHub. Owner only. It makes read-only GitHub requests with
 * the app's installation token, so it is limited per user. The answer lists each check as pass, fail or not
 * checked with one sentence; it never contains a token, a credential or the contents of the workflow file.
 */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  enforceRateLimit("githubCheck", user.id);
  const report = await checkGithubConnection(user.id, id, { eggUrl: config().APP_URL });
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
});

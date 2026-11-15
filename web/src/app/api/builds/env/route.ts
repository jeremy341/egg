import { NextResponse } from "next/server";
import { readBuildEnv } from "@/server/builds/env";
import { authenticateBuildCredential } from "@/server/builds/token";
import { handle } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";

/**
 * The project's variables for a build in GitHub Actions: { "KEY": "value" }. Public by design: the credential is
 * a build credential in `Authorization: Bearer <token>`, never in the path or the query string. ?env=preview reads
 * the preview variables and needs an `env_preview` credential; anything else reads production and needs an
 * `env_production` one. Never cached, never logged.
 */
export const GET = handle(
  async (req) => {
    const target = new URL(req.url).searchParams.get("env") === "preview" ? "preview" : "production";
    const projectId = await authenticateBuildCredential(req.headers, target === "preview" ? "env_preview" : "env_production");
    enforceRateLimit("buildEnv", projectId);
    const vars = await readBuildEnv(projectId, target);
    return NextResponse.json(vars, { headers: { "Cache-Control": "no-store" } });
  },
  { skipOriginCheck: true }
);

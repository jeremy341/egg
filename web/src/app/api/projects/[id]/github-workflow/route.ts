import { NextResponse } from "next/server";
import { WORKFLOW_PATH, WORKFLOW_SECRET_LIST, WorkflowError, buildWorkflow } from "@/server/builds/workflow";
import { BUILD_CREDENTIAL_TTL_MS } from "@/server/builds/token";
import { MAX_ARCHIVE_BYTES } from "@/server/deploy/build";
import { UPLOAD_WAIT_MS } from "@/server/builds/uploads";
import { config } from "@/server/config";
import { authed, handle, HttpError } from "@/server/http";
import { getProjectForUser } from "@/server/projects";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The GitHub Actions workflow for this project, made from its saved settings, and the names (never the values)
 * of the three repository secrets it reads. Owner only. Nothing secret is in the answer.
 */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const project = await getProjectForUser(user.id, id);
  let workflow: string;
  try {
    workflow = buildWorkflow({
      eggUrl: config().APP_URL,
      productionBranch: project.productionBranch,
      runtime: project.runtime,
      installCommand: project.installCommand,
      buildCommand: project.buildCommand,
      outputDir: project.outputDir,
      rootDir: project.rootDir,
    });
  } catch (err) {
    if (err instanceof WorkflowError) throw new HttpError(422, err.message, "workflow_invalid");
    throw err;
  }
  return NextResponse.json(
    {
      path: WORKFLOW_PATH,
      workflow,
      secrets: WORKFLOW_SECRET_LIST,
      // The numbers the dashboard shows, from the constants the server enforces.
      limits: {
        waitMinutes: UPLOAD_WAIT_MS / 60_000,
        maxArchiveMb: MAX_ARCHIVE_BYTES / (1024 * 1024),
        credentialDays: BUILD_CREDENTIAL_TTL_MS / (24 * 60 * 60 * 1000),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
});

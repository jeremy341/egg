import { authenticateUploadCredential } from "@/server/builds/token";
import { acceptUpload, parseUploadHeaders } from "@/server/builds/uploads";
import { handle, ok } from "@/server/http";
import { enforceIngress, enforceRateLimit } from "@/server/rate-limit";

/**
 * A finished release from a GitHub Actions workflow. Public by design: the credential is an `upload_preview` or
 * `upload_production` build credential in `Authorization: Bearer <token>`, never in the path or the query string, so
 * there are no cookies and no Origin check. A preview credential can only deliver a build to a preview deployment,
 * a production one only to a production deployment. The body is a .tar.gz of up to 500 MB, streamed to a private file; headers X-Egg-Commit,
 * X-Egg-Sha256, X-Egg-Branch and X-Egg-Run say what it is.
 */
export const POST = handle(
  async (req) => {
    enforceIngress(req.headers, "all");
    const { projectId, environment } = await authenticateUploadCredential(req.headers);
    enforceRateLimit("buildUpload", projectId);
    const headers = parseUploadHeaders(req.headers);
    const declared = req.headers.get("content-length");
    const { deploymentId } = await acceptUpload({
      projectId,
      environment,
      headers,
      body: req.body,
      contentLength: declared !== null && /^\d+$/.test(declared) ? Number(declared) : null,
    });
    return ok({ deployment: { id: deploymentId } }, 202);
  },
  { skipOriginCheck: true }
);

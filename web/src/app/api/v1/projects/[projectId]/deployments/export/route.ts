import { requireScope } from "@/server/api-tokens";
import { projectIdInput } from "@/server/api-v1-kit";
import { authenticate } from "@/server/api-v1-http";
import { enforceApiRate } from "@/server/api-v1";
import { DEPLOYMENT_COLUMNS, csvFilename, toCsv } from "@/server/export-csv";
import { csvResponse, exportDeployments } from "@/server/export-csv-data";
import { handle, zodToHttp } from "@/server/http";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * A project's deployment history as CSV, for an access token with
 * deployments:read. Bearer only, like the rest of /api/v1. It answers with CSV,
 * not JSON, so it is a route of its own and not in the endpoint list (and so
 * not in openapi.json or the MCP tools). It reads a long history, so it spends
 * from the small `ssh` allowance.
 */
export const GET = handle<Ctx>(
  async (req, { params }) => {
    const principal = await authenticate(req);
    enforceApiRate(principal, "ssh");
    requireScope(principal, "deployments:read");
    const parsed = projectIdInput.safeParse((await params).projectId);
    if (!parsed.success) throw zodToHttp(parsed.error);
    const { slug, rows, truncated } = await exportDeployments(principal.userId, parsed.data);
    return csvResponse(toCsv(rows, DEPLOYMENT_COLUMNS), csvFilename(`${slug}-deployments`, new Date()), truncated);
  },
  { skipOriginCheck: true }
);

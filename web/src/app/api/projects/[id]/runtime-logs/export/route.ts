import { authed, handle } from "@/server/http";
import { parseLogLevel, parseLogRange } from "@/lib/log-filter";
import { EXPORT_CONTENT_TYPE, exportFileName, exportText, parseExportFormat } from "@/lib/log-export";
import { enforceRateLimit } from "@/server/rate-limit";
import { exportRuntimeLogs } from "@/server/runtime-info";
import { getReadableProject } from "@/server/projects";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Download the logs as text or NDJSON. The logs page's filters apply (`range`,
 * `level`, `q`). `format` is `txt` (default) or `ndjson`. At most 10,000 lines;
 * `X-Logs-Truncated: true` says older lines were left out. The search text is
 * used for the read only and is not stored.
 */
export const GET = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const project = await getReadableProject(user.id, id);
  enforceRateLimit("sshCall", user.id);
  const sp = req.nextUrl.searchParams;
  const format = parseExportFormat(sp.get("format"));
  const range = parseLogRange(sp.get("range"));
  const result = await exportRuntimeLogs(user.id, id, {
    range,
    level: parseLogLevel(sp.get("level")),
    search: (sp.get("q") ?? "").slice(0, 200),
  });
  const name = exportFileName(project.name, range, format);
  return new Response(exportText(result.lines, format), {
    headers: {
      "content-type": EXPORT_CONTENT_TYPE[format],
      "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")}"`,
      "x-logs-truncated": result.truncated ? "true" : "false",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});

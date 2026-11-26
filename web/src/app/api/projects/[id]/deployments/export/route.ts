import { DEPLOYMENT_COLUMNS, csvFilename, toCsv } from "@/server/export-csv";
import { csvResponse, enforceExportRate, exportDeployments } from "@/server/export-csv-data";
import { authed, handle } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** One project's deployment history as CSV, newest first, at most 5000 rows. 404 unless it is yours. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  enforceExportRate(user.id);
  const { id } = await params;
  const { slug, rows, truncated } = await exportDeployments(user.id, id);
  return csvResponse(toCsv(rows, DEPLOYMENT_COLUMNS), csvFilename(`${slug}-deployments`, new Date()), truncated);
});

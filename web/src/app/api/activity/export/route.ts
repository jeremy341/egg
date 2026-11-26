import { parseFilters } from "@/server/activity";
import { ACTIVITY_COLUMNS, csvFilename, toCsv } from "@/server/export-csv";
import { csvResponse, enforceExportRate, exportActivity } from "@/server/export-csv-data";
import { authed, handle } from "@/server/http";

/**
 * The signed-in user's activity as CSV, with the same filters as the Activity
 * page (?kind=, ?range=, ?q=). At most 5000 entries, newest first.
 */
export const GET = handle(async (req) => {
  const user = await authed();
  enforceExportRate(user.id);
  const now = new Date();
  const { rows, truncated } = await exportActivity(user.id, parseFilters(req.nextUrl.searchParams), now);
  return csvResponse(toCsv(rows, ACTIVITY_COLUMNS), csvFilename("activity", now), truncated);
});

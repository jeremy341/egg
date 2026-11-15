import { parseFormat } from "@/lib/export-data";
import {
  badExport,
  buildExport,
  downloadResponse,
  parseExportCard,
  parseExportTab,
  renderExport,
} from "@/server/analytics-export";
import { enforceExportRate } from "@/server/export-csv-data";
import { authed, handle } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One analytics card as a CSV or JSON download: `?tab=overview&card=pages&format=csv`.
 * The card defaults to the tab's first, the format to CSV. 404 unless the project is yours.
 */
export const GET = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  enforceExportRate(user.id);
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const tab = parseExportTab(q.get("tab"));
  if (!tab) throw badExport("Choose a tab: overview, speed, events or visitors");
  const card = parseExportCard(tab, q.get("card"));
  if (!card) throw badExport("That card is not on this tab");
  const rawFormat = q.get("format");
  const format = rawFormat === null ? "csv" : parseFormat(rawFormat);
  if (!format) throw badExport("Choose a format: csv or json");
  const { body, contentType, filename } = renderExport(await buildExport(user.id, id, tab, card), format);
  return downloadResponse(body, contentType, filename);
});

import { analyticsSummary, campaignsSummary } from "@/server/analytics";
import { getFeatures, type AnalyticsFeatures } from "@/server/analytics-config";
import { eventsSummary } from "@/server/analytics-events";
import { retentionSummary } from "@/server/analytics-retention";
import { errorsSummary, speedSummary } from "@/server/analytics-speed";
import { CONTENT_TYPES, arrayColumns, exportFilename, toCsv, toJson, type CsvValue, type ExportFormat } from "@/lib/export-data";
import { HttpError, notFound } from "@/server/http";
import { getReadableProject } from "@/server/projects";

/**
 * What an analytics card exports. Each card reads the same summary function the page
 * reads for it, for the same 30 days, and turns exactly those numbers into rows. No row
 * holds a visitor code, a user id or a project key: the summaries do not carry them.
 */

export const EXPORT_DAYS = 30;

export const EXPORT_TABS = ["overview", "speed", "events", "visitors"] as const;
export type ExportTab = (typeof EXPORT_TABS)[number];

/** The cards of each tab that can be exported. The first is the one `?card=` falls back to. */
export const EXPORT_CARDS = {
  overview: ["daily", "pages", "referrers", "campaigns"],
  speed: ["lcp", "inp", "cls", "fcp", "ttfb", "errors-daily", "errors"],
  events: ["events", "events-by-name", "events-daily"],
  visitors: ["retention", "returning-daily"],
} as const satisfies Record<ExportTab, readonly string[]>;

export type ExportCard = (typeof EXPORT_CARDS)[ExportTab][number];

export function parseExportTab(raw: string | null | undefined): ExportTab | null {
  return EXPORT_TABS.find((t) => t === raw) ?? null;
}

/** The card named by `?card=`, the tab's first card when it is missing, or null when it is not one of the tab's. */
export function parseExportCard(tab: ExportTab, raw: string | null | undefined): ExportCard | null {
  const cards: readonly string[] = EXPORT_CARDS[tab];
  if (raw === null || raw === undefined || raw === "") return EXPORT_CARDS[tab][0];
  return (cards.includes(raw) ? raw : null) as ExportCard | null;
}

/** The switch a card needs. A card whose switch is off is not on the page, so it is not exported either. */
const NEEDS: Partial<Record<ExportCard, "campaigns" | "vitals" | "events" | "retention">> = {
  campaigns: "campaigns",
  lcp: "vitals",
  inp: "vitals",
  cls: "vitals",
  fcp: "vitals",
  ttfb: "vitals",
  "errors-daily": "vitals",
  errors: "vitals",
  events: "events",
  "events-by-name": "events",
  "events-daily": "events",
  retention: "retention",
  "returning-daily": "retention",
};

export type ExportTable = {
  /** The part of the file name after the project: "analytics-overview", "analytics-speed-lcp". */
  part: string;
  days: number;
  headers: string[];
  rows: CsvValue[][];
};

/** The file name leaves the card out for the tab's own first card, except on the speed tab where five cards share it. */
export function exportPart(tab: ExportTab, card: ExportCard): string {
  return card === EXPORT_CARDS[tab][0] && tab !== "speed" ? `analytics-${tab}` : `analytics-${tab}-${card}`;
}

const DAY = "Day (UTC)";

export async function buildExport(
  userId: string,
  projectId: string,
  tab: ExportTab,
  card: ExportCard,
  now = new Date()
): Promise<ExportTable & { slug: string }> {
  const project = await getReadableProject(userId, projectId);
  const need = NEEDS[card];
  if (need) {
    const features: AnalyticsFeatures = await getFeatures(project.id);
    if (!features[need]) throw notFound("That card is switched off");
  }
  const table = await tableFor(userId, project.id, card, now);
  return { ...table, part: exportPart(tab, card), slug: project.slug };
}

async function tableFor(
  userId: string,
  projectId: string,
  card: ExportCard,
  now: Date
): Promise<Omit<ExportTable, "part">> {
  const days = EXPORT_DAYS;
  switch (card) {
    case "daily": {
      const s = await analyticsSummary(userId, projectId, days, now);
      return { days, headers: [DAY, "Page views", "Visitors"], rows: s.daily.map((d) => [d.day, d.views, d.visitors]) };
    }
    case "pages": {
      const s = await analyticsSummary(userId, projectId, days, now);
      return { days, headers: ["Page", "Page views"], rows: s.pages.map((p) => [p.path, p.views]) };
    }
    case "referrers": {
      const s = await analyticsSummary(userId, projectId, days, now);
      return { days, headers: ["Referrer", "Page views"], rows: s.referrers.map((r) => [r.host, r.views]) };
    }
    case "campaigns": {
      const s = await campaignsSummary(userId, projectId, days, now);
      return {
        days,
        headers: ["Campaign", "Source", "Medium", "Page views"],
        rows: s.rows.map((r) => [r.campaign, r.source, r.medium, r.views]),
      };
    }
    case "lcp":
    case "inp":
    case "cls":
    case "fcp":
    case "ttfb": {
      const s = await speedSummary(userId, projectId, days, now);
      const m = s.metrics.find((x) => x.metric === card);
      const rows: CsvValue[][] = [];
      if (m) {
        rows.push(["Summary", "Median", m.median, m.unit, m.samples]);
        rows.push(["Summary", "75th percentile", m.p75, m.unit, m.samples]);
        for (const b of m.bands) rows.push(["Band", b.label, b.percent, "%", b.reports]);
        for (const d of m.daily) rows.push(["Day median", d.day, d.median, m.unit, d.reports]);
      }
      return { days: s.days, headers: ["Section", "Name", "Value", "Unit", "Reports"], rows };
    }
    case "errors-daily": {
      const s = await errorsSummary(userId, projectId, days, now);
      return { days, headers: [DAY, "Errors"], rows: s.daily.map((d) => [d.day, d.count]) };
    }
    case "errors": {
      const s = await errorsSummary(userId, projectId, days, now);
      return {
        days,
        headers: ["Message", "File", "Line", "Times", "Last seen (UTC)"],
        rows: s.rows.map((r) => [r.message, r.file, r.line, r.count, r.lastSeen.toISOString()]),
      };
    }
    case "events": {
      const s = await eventsSummary(userId, projectId, days, now);
      return { days, headers: ["Name", "Value", "Count"], rows: s.rows.map((r) => [r.name, r.value, r.count]) };
    }
    case "events-by-name": {
      const s = await eventsSummary(userId, projectId, days, now);
      return { days, headers: ["Name", "Count"], rows: s.byName.map((r) => [r.name, r.count]) };
    }
    case "events-daily": {
      const s = await eventsSummary(userId, projectId, days, now);
      return { days, headers: [DAY, "Events"], rows: s.daily.map((d) => [d.day, d.count]) };
    }
    case "retention": {
      const s = await retentionSummary(userId, projectId, now);
      return {
        days,
        headers: ["Measure", "Visitors", "Came back", "Return rate (%)"],
        rows: [
          ["Visitors in the last 7 days", s.visitorsThisWeek, null, null],
          ["First visit 7 to 14 days ago, back within 7 days", s.week.cohort, s.week.returned, s.week.percent],
          ["First visit 30 to 37 days ago, back within 30 days", s.month.cohort, s.month.returned, s.month.percent],
        ],
      };
    }
    case "returning-daily": {
      const s = await retentionSummary(userId, projectId, now);
      return {
        days,
        headers: [DAY, "New visitors", "Returning visitors"],
        rows: s.daily.map((d) => [d.day, d.newVisitors, d.returning]),
      };
    }
  }
}

/** The body, type and file name of a download. */
export function renderExport(table: ExportTable & { slug: string }, format: ExportFormat) {
  const columns = arrayColumns(table.headers);
  const body =
    format === "csv"
      ? toCsv(table.rows, columns)
      : toJson(table.rows, columns, { export: table.part, days: table.days });
  return {
    body,
    contentType: CONTENT_TYPES[format],
    filename: exportFilename({ slug: table.slug, part: table.part, days: table.days, format }),
  };
}

/** A download that is never cached and never sniffed into something a browser would render. */
export function downloadResponse(body: string, contentType: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "content-type": contentType,
      // exportFilename only produces [A-Za-z0-9_.-], so the plain form is safe as is.
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function badExport(message: string): HttpError {
  return new HttpError(400, message, "validation");
}

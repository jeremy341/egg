import type { ActivityItem } from "@/server/activity";

/**
 * CSV for the activity and deployment exports. Pure: no database, no request.
 *
 * Every field is quoted, so commas, quotes and newlines inside a value stay in
 * their cell. A value a spreadsheet would run as a formula (one that starts
 * with =, +, -, @, a tab or a carriage return) gets a leading single quote, so
 * Excel, Sheets and LibreOffice show it as text instead of evaluating it.
 */

export type CsvValue = string | number | boolean | null | undefined;

export type CsvColumn<T> = { header: string; value: (row: T) => CsvValue };

/** The most rows one export holds. */
export const EXPORT_ROW_LIMIT = 5000;

const FORMULA_START = /^[=+\-@\t\r]/;

function field(value: CsvValue): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** A header line, then one line per row, each ending in CRLF (RFC 4180). No columns, no text. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  if (columns.length === 0) return "";
  const line = (cells: CsvValue[]) => `${cells.map(field).join(",")}\r\n`;
  return line(columns.map((c) => c.header)) + rows.map((r) => line(columns.map((c) => c.value(r)))).join("");
}

/** "activity-2026-11-05.csv": the name with anything but letters, digits, _ and - folded to one dash, and the UTC day. */
export function csvFilename(name: string, now: Date): string {
  const base = name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
  return `${base}-${now.toISOString().slice(0, 10)}.csv`;
}

// ------------------------------------------------------------------ activity

/** "Started a deployment of Billing API from branch main", as the list reads it. */
function sentence(item: ActivityItem): string {
  let text = item.label;
  if (item.target) text += ` ${item.target.name}`;
  if (item.suffix) text += item.suffix.startsWith(":") ? item.suffix : ` ${item.suffix}`;
  return text;
}

/**
 * The activity columns. Every value comes from an `ActivityItem`, which only
 * carries meta that passed `cleanMeta`, so the secret-hiding rules of the page
 * apply to the file too. Links are left out: they are paths in this app.
 */
export const ACTIVITY_COLUMNS: CsvColumn<ActivityItem>[] = [
  { header: "Time (UTC)", value: (i) => i.at },
  { header: "Kind", value: (i) => i.kind },
  { header: "Action", value: (i) => i.action },
  { header: "Description", value: sentence },
  { header: "Target", value: (i) => i.target?.name ?? "" },
  { header: "Details", value: (i) => i.fields.map((f) => `${f.label}: ${f.value}`).join("; ") },
  { header: "Access token", value: (i) => (i.token ? (i.token.name ?? "(deleted token)") : "") },
  { header: "Entry id", value: (i) => i.id },
];

// --------------------------------------------------------------- deployments

/** The only deployment fields an export reads. No env values, logs, ports or URLs. */
export type DeploymentExportRow = {
  id: string;
  createdAt: Date;
  commitSha: string | null;
  branch: string;
  env: string;
  state: string;
  startedAt: Date | null;
  finishedAt: Date | null;
};

/** Whole seconds from start to finish, or null while it runs or if it never started. */
export function durationSeconds(d: Pick<DeploymentExportRow, "startedAt" | "finishedAt">): number | null {
  if (!d.startedAt || !d.finishedAt) return null;
  return Math.max(0, Math.round((d.finishedAt.getTime() - d.startedAt.getTime()) / 1000));
}

export const DEPLOYMENT_COLUMNS: CsvColumn<DeploymentExportRow>[] = [
  { header: "Created (UTC)", value: (d) => d.createdAt.toISOString() },
  { header: "Commit", value: (d) => d.commitSha?.slice(0, 7) ?? "" },
  { header: "Branch", value: (d) => d.branch },
  { header: "Environment", value: (d) => d.env },
  { header: "State", value: (d) => d.state },
  { header: "Duration (seconds)", value: durationSeconds },
  { header: "Deployment id", value: (d) => d.id },
];

/**
 * Log export: the same lines the logs page shows, as plain text or NDJSON
 * (one JSON object per line). Pure, so the server route and the tests share it.
 */
import { lineLevel, logFileName, type LogRange } from "@/lib/log-filter";

/** Most lines one export holds. The newest lines are kept when there are more. */
export const EXPORT_LINE_CAP = 10_000;

export type ExportFormat = "txt" | "ndjson";

export function parseExportFormat(value: string | null | undefined): ExportFormat {
  return value === "ndjson" ? "ndjson" : "txt";
}

/** Keep the newest `max` lines. `truncated` says whether any were dropped. */
export function capExport(lines: string[], max = EXPORT_LINE_CAP): { lines: string[]; truncated: boolean } {
  if (lines.length <= max) return { lines, truncated: false };
  return { lines: lines.slice(lines.length - max), truncated: true };
}

/** Plain text: one line per line, ending in a newline. Empty input gives an empty file. */
export function toPlainText(lines: string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/**
 * NDJSON: `{"level":"error","line":"..."}` per line. JSON escaping keeps a
 * line that contains a newline or a quote on one physical line.
 */
export function toNdjson(lines: string[]): string {
  return lines.map((line) => JSON.stringify({ level: lineLevel(line), line })).join("\n") + (lines.length ? "\n" : "");
}

export function exportText(lines: string[], format: ExportFormat): string {
  return format === "ndjson" ? toNdjson(lines) : toPlainText(lines);
}

/** e.g. "recipe-api-logs-24h-2026-11-05.ndjson". */
export function exportFileName(project: string, range: LogRange, format: ExportFormat, now = new Date()): string {
  return logFileName(project, range, now).replace(/\.txt$/, `.${format === "ndjson" ? "ndjson" : "txt"}`);
}

export const EXPORT_CONTENT_TYPE: Record<ExportFormat, string> = {
  txt: "text/plain; charset=utf-8",
  ndjson: "application/x-ndjson; charset=utf-8",
};

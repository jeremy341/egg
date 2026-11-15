import { toCsv as csvOf, type CsvColumn, type CsvValue } from "@/server/export-csv";

/**
 * The one place that turns rows into a downloadable file. Pure: no database, no request.
 *
 * CSV is built by the same function the activity and deployment exports use, so the
 * same rules apply everywhere: CRLF line endings (RFC 4180), every field quoted with
 * its quotes doubled (so commas, quotes and line breaks stay in their cell), and a
 * value a spreadsheet would run as a formula (one that starts with =, +, -, @, a tab
 * or a carriage return) gets a leading apostrophe. JSON has no such rule to follow.
 *
 * The caller chooses the rows and the columns, so a file holds only what the card
 * it comes from shows. Nothing here reads a user id or a secret.
 */

export type { CsvColumn, CsvValue };

export type ExportFormat = "csv" | "json";

export const EXPORT_FORMATS: readonly ExportFormat[] = ["csv", "json"];

/** The value of `?format=`, or null when it is not one of the two. */
export function parseFormat(raw: string | null | undefined): ExportFormat | null {
  return EXPORT_FORMATS.find((f) => f === raw) ?? null;
}

/** A header line, then one line per row, each ending in CRLF. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  return csvOf(rows, columns);
}

export type JsonMeta = Record<string, string | number | boolean | null>;

/**
 * The same rows as JSON: `{ ...meta, columns, rows }`, where each row is an object keyed by
 * the column header, in column order. Numbers stay numbers and an empty value is null.
 * Two-space indent and a final newline, so the file reads well in an editor.
 */
export function toJson<T>(rows: readonly T[], columns: readonly CsvColumn<T>[], meta: JsonMeta = {}): string {
  const body = {
    ...meta,
    columns: columns.map((c) => c.header),
    rows: rows.map((r) => {
      const out: Record<string, string | number | boolean | null> = {};
      for (const c of columns) {
        const v = c.value(r);
        out[c.header] = v === undefined || v === null ? null : v;
      }
      return out;
    }),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

/** Columns for rows that are plain arrays of cells, in the order of `headers`. */
export function arrayColumns(headers: readonly string[]): CsvColumn<readonly CsvValue[]>[] {
  return headers.map((header, i) => ({ header, value: (row) => row[i] }));
}

export type ExportName = {
  /** The project's slug. */
  slug: string;
  /** What the file is: "analytics-overview", "analytics-speed-lcp". */
  part: string;
  /** The range in days, written as "30d". */
  days: number;
  format: ExportFormat;
};

/** "standup-bot-analytics-overview-30d.csv": letters, digits, _ and - only, then the range and the extension. */
export function exportFilename({ slug, part, days, format }: ExportName): string {
  const base = `${slug}-${part}`.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
  return `${base}-${Math.max(1, Math.floor(days))}d.${format}`;
}

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
};

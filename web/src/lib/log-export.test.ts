import { describe, expect, it } from "vitest";
import {
  capExport,
  EXPORT_LINE_CAP,
  exportFileName,
  exportText,
  parseExportFormat,
  toNdjson,
  toPlainText,
} from "./log-export";

describe("toPlainText", () => {
  it("writes one line per line and ends with a newline", () => {
    expect(toPlainText(["a", "b"])).toBe("a\nb\n");
    expect(toPlainText([])).toBe("");
  });
});

describe("toNdjson", () => {
  it("writes one JSON object per line that parses back to the same text", () => {
    const lines = ["Nov 05 10:00:00 host app[1]: started", "ERROR boom \"quoted\"", "line with\ttab"];
    const out = toNdjson(lines);
    const rows = out.trimEnd().split("\n");
    expect(rows).toHaveLength(3);
    const parsed = rows.map((r) => JSON.parse(r) as { level: string; line: string });
    expect(parsed.map((p) => p.line)).toEqual(lines);
    expect(parsed[1].level).toBe("error");
    expect(parsed[0].level).toBe("info");
  });

  it("keeps a line with an embedded newline on one physical line", () => {
    const out = toNdjson(["first\nsecond"]);
    expect(out.split("\n")).toHaveLength(2); // the object and the empty string after the final newline
    expect(JSON.parse(out.trimEnd()).line).toBe("first\nsecond");
  });

  it("gives an empty file for no lines", () => {
    expect(toNdjson([])).toBe("");
  });
});

describe("capExport", () => {
  it("keeps everything under the cap", () => {
    expect(capExport(["a", "b"], 5)).toEqual({ lines: ["a", "b"], truncated: false });
  });

  it("keeps the newest lines when over the cap and says so", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const out = capExport(lines, 10);
    expect(out.truncated).toBe(true);
    expect(out.lines).toHaveLength(10);
    expect(out.lines[0]).toBe("n2");
    expect(out.lines.at(-1)).toBe("n11");
  });

  it("uses 10,000 lines by default", () => {
    expect(EXPORT_LINE_CAP).toBe(10_000);
    const lines = Array.from({ length: 10_001 }, (_, i) => String(i));
    expect(capExport(lines).lines).toHaveLength(10_000);
    expect(capExport(lines).truncated).toBe(true);
    expect(capExport(lines.slice(0, 10_000)).truncated).toBe(false);
  });
});

describe("export format and file name", () => {
  it("parses the format and defaults to text", () => {
    expect(parseExportFormat("ndjson")).toBe("ndjson");
    expect(parseExportFormat("txt")).toBe("txt");
    expect(parseExportFormat("csv")).toBe("txt");
    expect(parseExportFormat(null)).toBe("txt");
  });

  it("picks text or NDJSON output by format", () => {
    expect(exportText(["x"], "txt")).toBe("x\n");
    expect(exportText(["x"], "ndjson")).toBe(toNdjson(["x"]));
  });

  it("names the file with the matching extension", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(exportFileName("Recipe API!", "24h", "ndjson", now)).toBe("recipe-api-logs-24h-2026-11-05.ndjson");
    expect(exportFileName("Recipe API!", "7d", "txt", now)).toBe("recipe-api-logs-7d-2026-11-05.txt");
  });
});

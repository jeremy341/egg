import { describe, expect, it } from "vitest";
import { arrayColumns, exportFilename, parseFormat, toCsv, toJson } from "./export-data";

const columns = arrayColumns(["Name", "Count"]);

describe("toCsv", () => {
  it("writes a header line and one line per row, each ending in CRLF", () => {
    const csv = toCsv([["a", 1], ["b", 2]], columns);
    expect(csv).toBe('"Name","Count"\r\n"a","1"\r\n"b","2"\r\n');
    expect(csv.split("\r\n")).toHaveLength(4);
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it.each(["=", "+", "-", "@", "\t", "\r"])("puts an apostrophe before a cell that starts with %j", (lead) => {
    const csv = toCsv([[`${lead}SUM(A1)`, 1]], columns);
    expect(csv).toContain(`"'${lead}SUM(A1)"`);
    expect(csv).not.toContain(`"${lead}SUM(A1)"`);
  });

  it("leaves a cell alone when the formula character is not first", () => {
    expect(toCsv([["a=b", 1]], columns)).toContain('"a=b"');
  });

  it("neutralises the header too", () => {
    expect(toCsv([], arrayColumns(["=bad"]))).toBe(`"'=bad"\r\n`);
  });

  it("keeps commas, quotes and line breaks inside their cell", () => {
    const csv = toCsv([['say "hi", then\nleave', 3]], columns);
    expect(csv).toBe('"Name","Count"\r\n"say ""hi"", then\nleave","3"\r\n');
  });

  it("writes missing values as empty cells", () => {
    expect(toCsv([[null, undefined]], columns)).toBe('"Name","Count"\r\n"",""\r\n');
  });

  it("is just the header for no rows", () => {
    expect(toCsv([], columns)).toBe('"Name","Count"\r\n');
  });
});

describe("toJson", () => {
  it("keys each row by the column header, in column order, and keeps numbers as numbers", () => {
    const json = JSON.parse(toJson([["a", 1], ["b", null]], columns, { days: 30 }));
    expect(json).toEqual({
      days: 30,
      columns: ["Name", "Count"],
      rows: [
        { Name: "a", Count: 1 },
        { Name: "b", Count: null },
      ],
    });
  });

  it("is indented and ends with a newline", () => {
    const text = toJson([["a", 1]], columns);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "rows": [');
  });

  it("keeps text that starts with a formula character as it is, since JSON is not a spreadsheet", () => {
    expect(JSON.parse(toJson([["=1+1", 1]], columns)).rows[0].Name).toBe("=1+1");
  });
});

describe("exportFilename", () => {
  it("names the project, the card and the range", () => {
    expect(exportFilename({ slug: "standup-bot", part: "analytics-overview", days: 30, format: "csv" })).toBe(
      "standup-bot-analytics-overview-30d.csv"
    );
    expect(exportFilename({ slug: "standup-bot", part: "analytics-speed-lcp", days: 30, format: "json" })).toBe(
      "standup-bot-analytics-speed-lcp-30d.json"
    );
  });

  it("folds anything but letters, digits, _ and - so the header is safe", () => {
    expect(exportFilename({ slug: 'a"b/../c d', part: "analytics-x", days: 7, format: "csv" })).toBe("a-b-c-d-analytics-x-7d.csv");
  });
});

describe("parseFormat", () => {
  it("accepts csv and json only", () => {
    expect(parseFormat("csv")).toBe("csv");
    expect(parseFormat("json")).toBe("json");
    expect(parseFormat("xlsx")).toBeNull();
    expect(parseFormat(null)).toBeNull();
    expect(parseFormat("CSV")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { csvFilename, toCsv, type CsvColumn } from "./export-csv";

type Row = { a: unknown; b?: unknown };

const cols: CsvColumn<Row>[] = [
  { header: "First", value: (r) => r.a as never },
  { header: "Second", value: (r) => r.b as never },
];

const one = (value: unknown) =>
  toCsv([{ a: value }], [{ header: "H", value: (r: Row) => r.a as never }]).split("\r\n")[1];

describe("toCsv", () => {
  it("quotes every field, header included, and ends each record with CRLF", () => {
    expect(toCsv([{ a: "x", b: 2 }], cols)).toBe('"First","Second"\r\n"x","2"\r\n');
  });

  it("writes only the header for no rows", () => {
    expect(toCsv([], cols)).toBe('"First","Second"\r\n');
  });

  it("writes nothing when there are no columns", () => {
    expect(toCsv([{ a: 1 }], [])).toBe("");
  });

  it("doubles quotes inside a field", () => {
    expect(one('say "hi"')).toBe('"say ""hi"""');
  });

  it("keeps commas and newlines inside the quoted field", () => {
    const csv = toCsv([{ a: "one, two\nthree\r\nfour" }], [{ header: "H", value: (r: Row) => r.a as never }]);
    expect(csv).toBe('"H"\r\n"one, two\nthree\r\nfour"\r\n');
  });

  it("writes null and undefined as an empty field, booleans and numbers as text", () => {
    expect(toCsv([{ a: null, b: undefined }], cols)).toBe('"First","Second"\r\n"",""\r\n');
    expect(one(true)).toBe('"true"');
    expect(one(0)).toBe('"0"');
    expect(one(12.5)).toBe('"12.5"');
  });

  it.each([
    ["=SUM(A1:A9)", `"'=SUM(A1:A9)"`],
    ["+1+2", `"'+1+2"`],
    ["-2+3", `"'-2+3"`],
    ["@cmd", `"'@cmd"`],
    ["\t=1", `"'\t=1"`],
    ["\r=1", `"'\r=1"`],
    ['=HYPERLINK("http://x","y")', `"'=HYPERLINK(""http://x"",""y"")"`],
  ])("neutralises a formula-looking field %j", (value, expected) => {
    expect(one(value)).toBe(expected);
  });

  it("neutralises a formula-looking header", () => {
    expect(toCsv([], [{ header: "=bad", value: () => "" }])).toBe(`"'=bad"\r\n`);
  });

  it("leaves a formula character that is not first alone", () => {
    expect(one("a=b")).toBe('"a=b"');
    expect(one("main-2")).toBe('"main-2"');
    expect(one("user@example.com")).toBe('"user@example.com"');
  });

  it("passes unicode through unchanged", () => {
    expect(one("café 東京 🚀 Ünïcødé")).toBe('"café 東京 🚀 Ünïcødé"');
  });

  it("writes rows in the order given", () => {
    const csv = toCsv([{ a: 1 }, { a: 2 }, { a: 3 }], [{ header: "n", value: (r: Row) => r.a as never }]);
    expect(csv).toBe('"n"\r\n"1"\r\n"2"\r\n"3"\r\n');
  });
});

describe("csvFilename", () => {
  it("names the file after what it holds and the UTC day", () => {
    expect(csvFilename("activity", new Date("2026-11-05T23:30:00Z"))).toBe("activity-2026-11-05.csv");
  });

  it("keeps only safe characters from the name", () => {
    expect(csvFilename('my "app"/../x', new Date("2026-01-02T00:00:00Z"))).toBe("my-app-x-2026-01-02.csv");
  });
});

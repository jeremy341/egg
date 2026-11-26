import { describe, expect, it } from "vitest";
import {
  decodeLogCursor,
  encodeLogCursor,
  lineSeconds,
  newerLines,
  pageLogLines,
} from "./log-page";

/** A journal line, `sec` seconds after 10:00:00 UTC. */
const line = (sec: number, msg: string) => {
  const t = new Date(Date.UTC(2026, 10, 5, 10, 0, 0) + sec * 1000).toISOString().slice(0, 19);
  return `${t}+0000 host app[1]: ${msg}`;
};
const at = (sec: number) => Date.UTC(2026, 10, 5, 10, 0, 0) / 1000 + sec;

describe("lineSeconds", () => {
  it("reads short-iso stamps with an offset", () => {
    expect(lineSeconds("2026-11-05T10:00:03+0000 host app[1]: hi")).toBe(at(3));
    expect(lineSeconds("2026-11-05T12:00:03+0200 host app[1]: hi")).toBe(at(3));
    expect(lineSeconds("2026-11-05T05:00:03-05:00 host app[1]: hi")).toBe(at(3));
    expect(lineSeconds("2026-11-05T10:00:03Z host app[1]: hi")).toBe(at(3));
  });

  it("tolerates fractions and a space instead of the T", () => {
    expect(lineSeconds("2026-11-05 10:00:03.123456+0000 host app: hi")).toBe(at(3));
  });

  it("is null for lines without a stamp", () => {
    expect(lineSeconds("    at Object.<anonymous> (/app/x.js:1:1)")).toBeNull();
    expect(lineSeconds("-- No entries --")).toBeNull();
    expect(lineSeconds("Nov 05 10:00:03 host app[1]: hi")).toBeNull();
    expect(lineSeconds("")).toBeNull();
  });
});

describe("log cursor", () => {
  it("round-trips", () => {
    expect(decodeLogCursor(encodeLogCursor({ at: 1762336803, skip: 4 }))).toEqual({ at: 1762336803, skip: 4 });
  });

  it.each(["", "abc", "12", "12.", ".5", "12.5.6", "-1.2", "0.1", "1e9.1", "12; rm -rf /.1", 7, null])(
    "rejects %j",
    (raw) => {
      expect(decodeLogCursor(raw)).toBeNull();
    }
  );
});

describe("pageLogLines", () => {
  const base = { q: "", level: "all" as const, cursor: null };

  it("keeps the newest lines and points at the ones before", () => {
    const raw = [line(0, "a"), line(1, "b"), line(2, "c")];
    const page = pageLogLines(raw, { ...base, lines: 3, asked: 3 });
    expect(page.lines).toEqual(raw);
    // The read was full, so there may be more before the first line.
    expect(decodeLogCursor(page.older)).toEqual({ at: at(0), skip: 1 });
  });

  it("has no older cursor when the journal gave fewer lines than asked", () => {
    const raw = [line(0, "a"), line(1, "b")];
    const page = pageLogLines(raw, { ...base, lines: 300, asked: 300 });
    expect(page.lines).toEqual(raw);
    expect(page.older).toBeNull();
  });

  it("counts every line of the first second, so none is read twice", () => {
    const raw = [line(5, "a"), line(5, "b"), line(5, "c"), line(6, "d")];
    const page = pageLogLines(raw, { ...base, lines: 4, asked: 4 });
    expect(decodeLogCursor(page.older)).toEqual({ at: at(5), skip: 3 });
  });

  it("drops the already shown lines of the cursor's second and anything newer", () => {
    // Read up to second 5 (+1), asked 5 + 2 skipped: the journal returned 7 lines.
    const raw = [
      line(1, "a"),
      line(2, "b"),
      line(3, "c"),
      line(4, "d"),
      line(5, "e"), // not yet shown
      line(5, "f"), // shown
      line(5, "g"), // shown
    ];
    const page = pageLogLines(raw, {
      ...base,
      lines: 5,
      asked: 7,
      cursor: { at: at(5), skip: 2 },
    });
    expect(page.lines).toEqual([line(1, "a"), line(2, "b"), line(3, "c"), line(4, "d"), line(5, "e")]);
  });

  it("drops lines from the second after the cursor (--until reaches into it)", () => {
    const raw = [line(3, "a"), line(4, "b"), line(5, "c"), line(6, "d")];
    const page = pageLogLines(raw, { ...base, lines: 10, asked: 4, cursor: { at: at(5), skip: 1 } });
    expect(page.lines).toEqual([line(3, "a"), line(4, "b")]);
  });

  it("walks a journal page by page and ends without repeats or gaps", () => {
    // 10 lines, two per second, read 4 at a time the way the route does.
    const journal = Array.from({ length: 10 }, (_, i) => line(Math.floor(i / 2), `m${i}`));
    const read = (n: number, until?: number) => {
      const upTo = until === undefined ? journal : journal.filter((l) => (lineSeconds(l) as number) <= until);
      return upTo.slice(-n);
    };
    const out: string[][] = [];
    let cursor = null as ReturnType<typeof decodeLogCursor>;
    for (let guard = 0; guard < 10; guard++) {
      const asked = 4 + (cursor?.skip ?? 0);
      // `--until @(at+1)` includes second `at` and a hair more; `<= at` is what is left after the drop.
      const raw = read(asked, cursor?.at);
      const page = pageLogLines(raw, { ...base, lines: 4, asked, cursor });
      out.unshift(page.lines);
      cursor = decodeLogCursor(page.older);
      if (!cursor) break;
    }
    expect(out.flat()).toEqual(journal);
  });

  it("makes progress on every page, even if filters hide every line read", () => {
    const raw = [line(1, "a"), line(2, "b"), line(3, "c")];
    const page = pageLogLines(raw, { ...base, q: "zzz", lines: 3, asked: 3 });
    expect(page.lines).toEqual([]);
    expect(decodeLogCursor(page.older)).toEqual({ at: at(1), skip: 1 });
    const next = pageLogLines([line(0, "x"), line(1, "a")], {
      ...base,
      q: "zzz",
      lines: 3,
      asked: 3,
      cursor: decodeLogCursor(page.older),
    });
    expect(next.lines).toEqual([]);
    expect(next.older).toBeNull();
  });

  it("cuts a wide filtered read to the newest lines and points just before the first kept", () => {
    const raw = Array.from({ length: 8 }, (_, i) => line(i, i % 2 ? "ok" : "ERROR boom"));
    const page = pageLogLines(raw, { ...base, level: "problems", lines: 2, asked: 1000 });
    expect(page.lines).toEqual([line(4, "ERROR boom"), line(6, "ERROR boom")]);
    // Journal was not full (8 < 1000) but the page was cut, so there is more.
    expect(decodeLogCursor(page.older)).toEqual({ at: at(4), skip: 1 });
  });

  it("filters by search without case", () => {
    const raw = [line(0, "Started"), line(1, "Listening on 3000"), line(2, "request")];
    expect(pageLogLines(raw, { ...base, q: "listening", lines: 10, asked: 1000 }).lines).toEqual([raw[1]]);
  });

  it("gives continuation lines the stamp above, and no cursor when no line has one", () => {
    const raw = ["no stamp here", "or here"];
    const page = pageLogLines(raw, { ...base, lines: 2, asked: 2 });
    expect(page.lines).toEqual(raw);
    expect(page.older).toBeNull();
    const withTrace = [line(1, "Error: x"), "    at f (a.js:1:1)", line(2, "ok")];
    expect(decodeLogCursor(pageLogLines(withTrace, { ...base, lines: 3, asked: 3 }).older)).toEqual({
      at: at(1),
      skip: 2,
    });
  });

  it("returns no lines and no cursor for an empty read", () => {
    expect(pageLogLines([], { ...base, lines: 300, asked: 300 })).toEqual({ lines: [], older: null });
  });
});

describe("newerLines", () => {
  it("returns only the lines after the overlap", () => {
    expect(newerLines(["a", "b", "c"], ["b", "c", "d", "e"])).toEqual(["d", "e"]);
  });

  it("returns nothing new when the read is the same", () => {
    expect(newerLines(["a", "b"], ["a", "b"])).toEqual([]);
    expect(newerLines(["a", "b"], [])).toEqual([]);
  });

  it("is null when the two share no line, so nothing is joined over a gap", () => {
    expect(newerLines(["a", "b"], ["x", "y"])).toBeNull();
  });

  it("uses the longest overlap", () => {
    expect(newerLines(["x", "a", "x", "a"], ["x", "a", "b"])).toEqual(["b"]);
  });
});

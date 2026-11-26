import { describe, expect, it } from "vitest";
import {
  ERROR_MESSAGE_MAX,
  allowlistedUtm,
  parseUtmAllowlist,
  UTM_MAX,
  VITALS,
  VITAL_THRESHOLDS,
  cleanError,
  cleanEventName,
  cleanEventValue,
  cleanReferrer,
  cleanUtm,
  cleanVital,
  formatVital,
  median,
  percentile,
  rateVital,
} from "@/server/analytics-fields";

describe("cleanReferrer", () => {
  it("keeps a host as it is, so www. stays", () => {
    expect(cleanReferrer("www.news.example.com")).toBe("www.news.example.com");
    expect(cleanReferrer("News.Example.com")).toBe("news.example.com");
  });
  it("reduces a full address from an older script to its host, with no path, query or port", () => {
    expect(cleanReferrer("https://www.news.example.com:8443/post/1?id=9#top")).toBe("www.news.example.com");
  });
  it("drops anything that is not a web host", () => {
    for (const bad of ["javascript:alert(1)", "not a url", "", "a b.example", "x".repeat(200) + ".com/"]) {
      expect(cleanReferrer(bad), bad).toBeNull();
    }
    expect(cleanReferrer(undefined)).toBeNull();
    expect(cleanReferrer(null)).toBeNull();
  });
});

describe("cleanUtm", () => {
  it("trims each value and cuts it to 80 characters", () => {
    const u = cleanUtm({ source: "  newsletter  ", medium: "x".repeat(200), campaign: "y".repeat(UTM_MAX) });
    expect(u.source).toBe("newsletter");
    expect(u.medium).toHaveLength(UTM_MAX);
    expect(u.campaign).toHaveLength(UTM_MAX);
  });
  it("reads only source, medium and campaign", () => {
    const u = cleanUtm({ source: "a", medium: "b", campaign: "c", term: "secret", content: "x", email: "a@b.co" } as never);
    expect(u).toEqual({ source: "a", medium: "b", campaign: "c" });
  });
  it("is null for a missing, empty or non-text value", () => {
    expect(cleanUtm({ source: "   ", medium: 5, campaign: undefined })).toEqual({ source: null, medium: null, campaign: null });
    expect(cleanUtm(undefined)).toEqual({ source: null, medium: null, campaign: null });
  });
  it("does not cut a character in half", () => {
    const face = String.fromCodePoint(0x1f600);
    expect(cleanUtm({ source: face.repeat(100) }).source).toBe(face.repeat(UTM_MAX));
  });
});

describe("campaign allowlist", () => {
  it("sends only exact allowlisted campaign labels", () => {
    const allowed = parseUtmAllowlist({ source: ["newsletter"], medium: ["email"], campaign: ["spring-26"] });
    expect(allowlistedUtm({ source: "newsletter", medium: "email", campaign: "spring-26" }, allowed)).toEqual({
      source: "newsletter", medium: "email", campaign: "spring-26",
    });
    expect(allowlistedUtm({ source: "alice@example.com", medium: "email", campaign: "spring-26?user=alice" }, allowed)).toEqual({
      source: null, medium: "email", campaign: null,
    });
  });
  it("drops malformed, unsafe, duplicate and excessive values", () => {
    expect(parseUtmAllowlist({
      source: ["good", "a@b.test", "good", "x".repeat(41), "ok", ...Array(30).fill("another")],
      medium: "email",
      unexpected: ["drop-me"],
    })).toEqual({ source: ["good", "ok", "another"], medium: [], campaign: [] });
    expect(parseUtmAllowlist("not-json")).toEqual({ source: [], medium: [], campaign: [] });
  });
});

describe("event names and values", () => {
  it("accept plain text of 1 to 40 characters", () => {
    for (const ok of ["pro", "Pro plan", "plan:pro_2", "a".repeat(40), "v1.2-beta"]) {
      expect(cleanEventValue(ok), ok).toBe(ok);
      expect(cleanEventName(ok), ok).toBe(ok);
    }
  });
  it("trim the text but reject anything else", () => {
    expect(cleanEventValue("  pro  ")).toBe("pro");
    for (const bad of ["", "   ", "a".repeat(41), "sam@example.com", "<b>x</b>", "x\ny", "-start", "a/b", 42, null, undefined]) {
      expect(cleanEventValue(bad), String(bad)).toBeNull();
      expect(cleanEventName(bad), String(bad)).toBeNull();
    }
  });
});

describe("web vitals", () => {
  it("uses Google's published thresholds", () => {
    expect(VITAL_THRESHOLDS).toEqual({
      lcp: [2500, 4000],
      cls: [0.1, 0.25],
      inp: [200, 500],
      fcp: [1800, 3000],
      ttfb: [800, 1800],
    });
  });
  it.each([
    ["lcp", 2500, "good"],
    ["lcp", 2501, "needs-work"],
    ["lcp", 4000, "needs-work"],
    ["lcp", 4001, "poor"],
    ["cls", 0.1, "good"],
    ["cls", 0.11, "needs-work"],
    ["cls", 0.25, "needs-work"],
    ["cls", 0.26, "poor"],
    ["inp", 200, "good"],
    ["inp", 500, "needs-work"],
    ["inp", 501, "poor"],
    ["fcp", 1800, "good"],
    ["fcp", 3000, "needs-work"],
    ["fcp", 3001, "poor"],
    ["ttfb", 800, "good"],
    ["ttfb", 1800, "needs-work"],
    ["ttfb", 1801, "poor"],
  ] as const)("rates %s of %d as %s", (metric, value, rating) => {
    expect(rateVital(metric, value)).toBe(rating);
  });

  it("rounds milliseconds to whole numbers and layout shift to three decimals", () => {
    expect(cleanVital("lcp", 1234.56)).toBe(1235);
    expect(cleanVital("cls", 0.123456)).toBe(0.123);
    expect(cleanVital("ttfb", 0)).toBe(0);
  });
  it("drops what is not a sane measurement", () => {
    for (const metric of VITALS) {
      for (const bad of [-1, Number.NaN, Infinity, "12", null, undefined, {}]) {
        expect(cleanVital(metric, bad), `${metric} ${String(bad)}`).toBeNull();
      }
    }
    expect(cleanVital("lcp", 600_001)).toBeNull();
    expect(cleanVital("cls", 101)).toBeNull();
  });
});

describe("median and percentile", () => {
  it("takes the middle value, or the mean of the two middle ones", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(median([])).toBeNull();
  });
  it("uses the nearest rank for a percentile", () => {
    const ten = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(ten, 75)).toBe(80);
    expect(percentile(ten, 50)).toBe(50);
    expect(percentile(ten, 100)).toBe(100);
    expect(percentile(ten, 1)).toBe(10);
    expect(percentile([1, 2, 3, 4], 75)).toBe(3);
    expect(percentile([9], 75)).toBe(9);
    expect(percentile([], 75)).toBeNull();
  });
  it("does not change the list it is given", () => {
    const v = [3, 1, 2];
    median(v);
    percentile(v, 75);
    expect(v).toEqual([3, 1, 2]);
  });
});

describe("cleanError", () => {
  it("cuts the message to 200 characters", () => {
    const e = cleanError({ message: "x".repeat(500), file: "app.js", line: 3 });
    expect(e?.message).toHaveLength(ERROR_MESSAGE_MAX);
  });
  it("keeps the file name without its address, query or fragment", () => {
    expect(cleanError({ message: "boom", file: "https://cdn.example.com/static/js/app.3f2.js?token=abc#x", line: 12 })).toEqual({
      message: "boom",
      file: "app.3f2.js",
      line: 12,
    });
  });
  it("cuts web addresses in the message back to their path and replaces email addresses", () => {
    const e = cleanError({ message: "Failed to fetch https://api.example.com/v1/users?token=abc&id=9 for sam@example.com" });
    expect(e?.message).toBe("Failed to fetch https://api.example.com/v1/users for [email]");
  });
  it("is null with no message, and null for a bad file or line", () => {
    expect(cleanError({ message: "   " })).toBeNull();
    expect(cleanError({ message: 5 })).toBeNull();
    expect(cleanError({ message: "x", file: 5, line: -3 })).toEqual({ message: "x", file: null, line: null });
    expect(cleanError({ message: "x", file: "", line: 1.5 })).toEqual({ message: "x", file: null, line: null });
  });
});

describe("formatVital", () => {
  it("writes every figure with its unit: ms under a second, s above, and a score with none", () => {
    expect(formatVital("ttfb", 640)).toBe("640 ms");
    expect(formatVital("lcp", 2412)).toBe("2.41 s");
    expect(formatVital("inp", 200)).toBe("200 ms");
    expect(formatVital("cls", 0.0834)).toBe("0.083");
  });
});

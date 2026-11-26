import { describe, expect, it } from "vitest";
import { NO_STATISTICS } from "@/server/statistics";
import { STATISTIC_COPY, STATISTIC_ORDER } from "@/lib/statistics-copy";

describe("statistics settings copy", () => {
  it("has one row of copy for every server switch, in order", () => {
    expect([...STATISTIC_ORDER].sort()).toEqual(Object.keys(NO_STATISTICS).sort());
    for (const key of STATISTIC_ORDER) {
      expect(STATISTIC_COPY[key].title.length).toBeGreaterThan(0);
      expect(STATISTIC_COPY[key].sentence.length).toBeGreaterThan(0);
    }
  });
});

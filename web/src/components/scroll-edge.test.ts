import { describe, expect, it } from "vitest";
import { moreToScroll } from "@/components/scroll-edge";

describe("moreToScroll", () => {
  it("is false when the content fits", () => {
    expect(moreToScroll({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 })).toBe(false);
  });
  it("is true while content hides beyond the right edge", () => {
    expect(moreToScroll({ scrollLeft: 0, clientWidth: 300, scrollWidth: 620 })).toBe(true);
    expect(moreToScroll({ scrollLeft: 100, clientWidth: 300, scrollWidth: 620 })).toBe(true);
  });
  it("is false at the end, allowing for rounding", () => {
    expect(moreToScroll({ scrollLeft: 320, clientWidth: 300, scrollWidth: 620 })).toBe(false);
    expect(moreToScroll({ scrollLeft: 319.4, clientWidth: 300, scrollWidth: 620 })).toBe(false);
  });
});

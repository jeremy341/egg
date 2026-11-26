import { describe, expect, it } from "vitest";
import { PULL_POLICIES, pullFlagFor } from "@/server/deploy/pull-policy";

describe("pull policy", () => {
  it("offers auto, always and cached", () => {
    expect([...PULL_POLICIES]).toEqual(["auto", "always", "cached"]);
  });

  it("maps each policy to its docker run flag", () => {
    expect(pullFlagFor("auto")).toBe("--pull=missing");
    expect(pullFlagFor("always")).toBe("--pull=always");
    expect(pullFlagFor("cached")).toBe("--pull=never");
  });
});

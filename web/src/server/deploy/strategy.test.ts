import { describe, expect, it } from "vitest";
import { DEPLOY_STRATEGIES, strategyRefusal } from "@/server/deploy/strategy";

describe("deploy strategies", () => {
  it("offers exactly rolling, recreate and blue/green", () => {
    expect([...DEPLOY_STRATEGIES]).toEqual(["rolling", "recreate", "blue_green"]);
  });

  it("allows every strategy for an app without a volume", () => {
    for (const strategy of DEPLOY_STRATEGIES) {
      expect(strategyRefusal({ strategy, hasVolume: false })).toBeNull();
    }
  });

  it("allows recreate for an app with a volume", () => {
    expect(strategyRefusal({ strategy: "recreate", hasVolume: true })).toBeNull();
  });

  it("refuses rolling and blue/green for an app with a volume, with a clear message", () => {
    for (const strategy of ["rolling", "blue_green"] as const) {
      const message = strategyRefusal({ strategy, hasVolume: true });
      expect(message).toContain("must use the recreate strategy");
      expect(message).toContain("volume");
    }
  });
});

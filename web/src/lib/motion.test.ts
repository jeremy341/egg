import { afterEach, describe, expect, it, vi } from "vitest";
import { motionReduced } from "@/lib/motion";

function setup(attr: string | null, deviceReduce: boolean) {
  vi.stubGlobal("document", {
    documentElement: { getAttribute: (name: string) => (name === "data-motion" ? attr : null) },
  });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: deviceReduce }) });
}

describe("motionReduced", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("follows the device when the Settings choice is system", () => {
    setup(null, true);
    expect(motionReduced()).toBe(true);
    setup(null, false);
    expect(motionReduced()).toBe(false);
  });

  it("turns motion off when Settings says reduce, whatever the device says", () => {
    setup("reduce", false);
    expect(motionReduced()).toBe(true);
  });

  it("keeps entrance effects off when the device asks for less, as the CSS does", () => {
    setup("no-preference", true);
    expect(motionReduced()).toBe(true);
  });
});

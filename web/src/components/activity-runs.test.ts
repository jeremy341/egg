import { describe, expect, it } from "vitest";
import { groupRuns, runLabel } from "@/components/activity-runs";

const item = (id: number, kind: string) => ({ id, kind }) as { id: number; kind: "access" | "servers" | "projects" };

describe("groupRuns", () => {
  it("leaves short runs as single entries", () => {
    const out = groupRuns([item(1, "access"), item(2, "access"), item(3, "servers")]);
    expect(out.map((e) => e.type)).toEqual(["item", "item", "item"]);
  });

  it("folds three or more neighbours of the same kind into one run, in order", () => {
    const items = [item(1, "projects"), item(2, "access"), item(3, "access"), item(4, "access"), item(5, "access"), item(6, "servers")];
    const out = groupRuns(items);
    expect(out.map((e) => e.type)).toEqual(["item", "run", "item"]);
    const run = out[1];
    expect(run.type === "run" && run.items.map((i) => i.id)).toEqual([2, 3, 4, 5]);
    expect(run.type === "run" && run.kind).toBe("access");
  });

  it("never drops or reorders an entry", () => {
    const items = Array.from({ length: 12 }, (_, i) => item(i, i % 5 < 4 ? "access" : "servers"));
    const flat = groupRuns(items).flatMap((e) => (e.type === "run" ? e.items : [e.item]));
    expect(flat.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it("does not join kinds that are split by another kind", () => {
    const out = groupRuns([item(1, "access"), item(2, "access"), item(3, "servers"), item(4, "access"), item(5, "access")]);
    expect(out.every((e) => e.type === "item")).toBe(true);
  });

  it("honours a custom minimum", () => {
    const out = groupRuns([item(1, "access"), item(2, "access")], 2);
    expect(out.map((e) => e.type)).toEqual(["run"]);
  });
});

describe("runLabel", () => {
  it("says how many and of what, in sentence case", () => {
    expect(runLabel("access", 4)).toBe("4 token and access changes");
    expect(runLabel("servers", 3)).toBe("3 server changes");
  });
});

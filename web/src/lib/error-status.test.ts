import { describe, expect, it } from "vitest";
import { nextErrorStatus, parseErrorGroupStatus } from "./error-status";

describe("nextErrorStatus", () => {
  it("resolves open and ignored groups, not resolved ones", () => {
    expect(nextErrorStatus("open", "resolve")).toBe("resolved");
    expect(nextErrorStatus("ignored", "resolve")).toBe("resolved");
    expect(nextErrorStatus("resolved", "resolve")).toBeNull();
  });

  it("reopens resolved and ignored groups, not open ones", () => {
    expect(nextErrorStatus("resolved", "reopen")).toBe("open");
    expect(nextErrorStatus("ignored", "reopen")).toBe("open");
    expect(nextErrorStatus("open", "reopen")).toBeNull();
  });

  it("ignores open and resolved groups, not ignored ones", () => {
    expect(nextErrorStatus("open", "ignore")).toBe("ignored");
    expect(nextErrorStatus("resolved", "ignore")).toBe("ignored");
    expect(nextErrorStatus("ignored", "ignore")).toBeNull();
  });

  it("assign keeps the status in every state", () => {
    expect(nextErrorStatus("open", "assign")).toBe("open");
    expect(nextErrorStatus("resolved", "assign")).toBe("resolved");
    expect(nextErrorStatus("ignored", "assign")).toBe("ignored");
  });
});

describe("parseErrorGroupStatus", () => {
  it("accepts the three statuses and defaults to all", () => {
    expect(parseErrorGroupStatus("open")).toBe("open");
    expect(parseErrorGroupStatus("resolved")).toBe("resolved");
    expect(parseErrorGroupStatus("ignored")).toBe("ignored");
    expect(parseErrorGroupStatus("closed")).toBe("all");
    expect(parseErrorGroupStatus(undefined)).toBe("all");
  });
});

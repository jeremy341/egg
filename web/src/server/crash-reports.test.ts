import { describe, expect, it } from "vitest";
import { parseServiceStatus } from "@/server/service-status";

describe("crash report identity", () => {
  it("keeps the systemd invocation id used to deduplicate one crash", () => {
    const invocationId = "b9c46f196d594367a2aebfd2a2cdd5ca";
    const status = parseServiceStatus([
      "EGG_LoadState=loaded",
      "EGG_ActiveState=failed",
      `EGG_InvocationID=${invocationId}`,
    ].join("\n"));

    expect(status.invocationId).toBe(invocationId);
  });
});

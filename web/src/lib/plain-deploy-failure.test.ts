import { describe, expect, it } from "vitest";
import { classifyPlainDeployFailure } from "@/lib/plain-deploy-failure";

describe("classifyPlainDeployFailure", () => {
  it("explains EADDRINUSE with the port and raw matching line", () => {
    const line = "Error: listen EADDRINUSE: address already in use :::3000";

    expect(classifyPlainDeployFailure({ lines: [line], port: 3000 })).toEqual({
      plainMessage: "Port 3000 is already in use by another process.",
      plainLine: line,
    });
  });
});

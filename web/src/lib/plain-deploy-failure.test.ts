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

  it.each([
    ["exit 137", "Process exited with code 137"],
    ["exit 9", "Process exited with code 9"],
    ["the OOM killer", "Killed by the OOM killer"],
  ])("explains an OOM kill from %s and names the configured limit", (_name, line) => {
    expect(classifyPlainDeployFailure({ lines: [line], memoryLimitMb: 1024 })).toEqual({
      plainMessage: "Memory ran out. The configured limit is 1024 MB.",
      plainLine: line,
    });
  });

  it("reads the configured memory limit from the deploy log", () => {
    const line = "The build failed (exit 137).";

    expect(classifyPlainDeployFailure({ lines: ["Building on your container, capped at 1536 MB of memory.", line], stage: "building" })).toEqual({
      plainMessage: "Memory ran out. The configured limit is 1536 MB.",
      plainLine: line,
    });
  });

  it.each([
    ["MODULE_NOT_FOUND", "Error: Cannot find module 'left-pad'"],
    ["ERR_MODULE_NOT_FOUND", "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'left-pad' imported from /app/index.js"],
  ])("names the missing module for %s", (_code, line) => {
    expect(classifyPlainDeployFailure({ lines: [line] })).toEqual({
      plainMessage: 'Module "left-pad" could not be found. The install step may not have run.',
      plainLine: line,
    });
  });

  it.each([
    "The start command is empty.",
    "Nothing to run in this release.",
    "Set a start command for this project.",
  ])("explains an empty start command from %j", (line) => {
    expect(classifyPlainDeployFailure({ lines: [line] })).toEqual({
      plainMessage: "The start command is empty.",
      plainLine: line,
    });
  });

  it("explains an unclassified exit 1 during startup by pointing to the last lines", () => {
    const line = "Process exited with code 1 during startup.";

    expect(classifyPlainDeployFailure({ lines: [line], stage: "starting" })).toEqual({
      plainMessage: "The app exited during startup. Check the last lines of the log for details.",
      plainLine: line,
    });
  });

  it("returns no plain message when none of the common failures match", () => {
    expect(classifyPlainDeployFailure({ lines: ["The build did not finish."] })).toBeNull();
  });
});

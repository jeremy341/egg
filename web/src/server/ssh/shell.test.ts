import { describe, expect, it } from "vitest";
import { projectDir } from "@/server/deploy/layout";
import { assertShellDir, startupCommand } from "@/server/ssh/shell";

describe("assertShellDir", () => {
  it("accepts a project folder built the way deploy/layout.ts builds it", () => {
    const dir = projectDir("/home/sam-r", "recipe-api");
    expect(assertShellDir(dir)).toBe(dir);
  });

  it("rejects anything that is not <home>/.egg/<slug>", () => {
    for (const bad of [
      "",
      "relative/.egg/app",
      "/home/sam/.egg/..",
      "/home/sam/.egg/../../etc",
      "/home/sam/../root/.egg/app",
      "/home/sam/.egg/App",
      "/home/sam/.egg/-bad",
      "/home/sam/other/app",
      "/home/sam/.egg/app/releases",
      "/home/sam//.egg/app",
      "/home/sam/.egg/./app",
      "/home/sam/.egg/app'; rm -rf /; '",
      "/home/sam/.egg/app$(id)",
      "/home/sam/.egg/app\nid",
      "/home/sam/.egg deploy/app",
    ]) {
      expect(() => assertShellDir(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("startupCommand", () => {
  it("is one line that changes into the folder and stays out of shell history", () => {
    const cmd = startupCommand("/home/sam-r/.egg/recipe-api");
    expect(cmd.startsWith(" ")).toBe(true);
    expect(cmd.endsWith("\n")).toBe(true);
    expect(cmd.trimEnd().split("\n")).toHaveLength(1);
    expect(cmd).toContain("cd -- '/home/sam-r/.egg/recipe-api'");
  });

  it("refuses a folder that fails validation", () => {
    expect(() => startupCommand("/etc")).toThrow();
  });
});

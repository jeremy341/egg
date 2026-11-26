import { describe, expect, it } from "vitest";
import { buildFailureMessage, dockerBuildArgs } from "@/server/deploy/build";

const base = {
  name: "egg-build-abc",
  srcDir: "/work/src",
  rel: "app",
  image: "node:22",
  script: "npm run build",
  cliArgv: [] as string[],
};
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("docker build command memory", () => {
  it("uses the limit of the server it was given, with no swap on top", () => {
    const args = dockerBuildArgs({ ...base, memoryMb: 4096 });
    expect(after(args, "--memory")).toBe("4096m");
    expect(after(args, "--memory-swap")).toBe("4096m");
  });

  it("uses 2048 MB when no limit is given", () => {
    const args = dockerBuildArgs(base);
    expect(after(args, "--memory")).toBe("2048m");
    expect(after(args, "--memory-swap")).toBe("2048m");
  });

  it("is per request: two servers give two different commands", () => {
    const a = dockerBuildArgs({ ...base, memoryMb: 1024 });
    const b = dockerBuildArgs({ ...base, memoryMb: 6144 });
    expect(after(a, "--memory")).toBe("1024m");
    expect(after(b, "--memory")).toBe("6144m");
  });

  it("refuses a limit outside 512 to 8192 when nothing reports more", () => {
    expect(() => dockerBuildArgs({ ...base, memoryMb: 100 })).toThrow(/512/);
    expect(() => dockerBuildArgs({ ...base, memoryMb: 100000 })).toThrow(/memory/i);
    expect(() => dockerBuildArgs({ ...base, memoryMb: 1.5 })).toThrow();
  });

  it("allows up to the memory the server reported", () => {
    const args = dockerBuildArgs({ ...base, memoryMb: 12000, serverMemoryMb: 16384 });
    expect(after(args, "--memory")).toBe("12000m");
    expect(() => dockerBuildArgs({ ...base, memoryMb: 16385, serverMemoryMb: 16384 })).toThrow(/16384/);
  });
});

describe("build failure message", () => {
  it("says the build ran out of memory and where to change it when docker kills it", () => {
    const m = buildFailureMessage(137, 2048);
    expect(m).toMatch(/ran out of memory/i);
    expect(m).toMatch(/2048 MB/);
    expect(m).toMatch(/Container page/);
  });

  it("keeps the plain message for other exit codes", () => {
    expect(buildFailureMessage(1, 2048)).toBe("The build failed (exit 1).");
  });
});

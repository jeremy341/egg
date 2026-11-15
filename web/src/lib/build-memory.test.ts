import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUILD_MEMORY_MB,
  DEFAULT_BUILD_CPUS,
  buildMemoryRange,
  buildCpuRange,
  checkBuildCpu,
  checkBuildMemory,
  reportedMemoryMb,
  reportedCpus,
} from "@/lib/build-memory";

describe("build memory range", () => {
  it("defaults to 2048 MB", () => {
    expect(DEFAULT_BUILD_MEMORY_MB).toBe(2048);
  });

  it("goes from 512 to the total memory the server reports", () => {
    expect(buildMemoryRange(16384)).toEqual({ min: 512, max: 16384 });
  });

  it("goes up to 8192 when the probe did not report memory", () => {
    expect(buildMemoryRange(null)).toEqual({ min: 512, max: 8192 });
    expect(buildMemoryRange(undefined)).toEqual({ min: 512, max: 8192 });
    expect(buildMemoryRange(0)).toEqual({ min: 512, max: 8192 });
  });

  it("never lets the top fall below the bottom", () => {
    expect(buildMemoryRange(256)).toEqual({ min: 512, max: 512 });
  });

  it("refuses a value outside the range and anything that is not a whole number", () => {
    expect(checkBuildMemory(512, null)).toBeNull();
    expect(checkBuildMemory(8192, null)).toBeNull();
    expect(checkBuildMemory(511, null)).toMatch(/512/);
    expect(checkBuildMemory(8193, null)).toMatch(/8192/);
    expect(checkBuildMemory(8193, 16384)).toBeNull();
    expect(checkBuildMemory(16385, 16384)).toMatch(/16384/);
    expect(checkBuildMemory(1024.5, null)).not.toBeNull();
    expect(checkBuildMemory(Number.NaN, null)).not.toBeNull();
  });
});

describe("reported memory", () => {
  it("reads memTotalMb from the stored probe and is null when it is missing or unreadable", () => {
    expect(reportedMemoryMb(JSON.stringify({ memTotalMb: 4096 }))).toBe(4096);
    expect(reportedMemoryMb(JSON.stringify({ memTotalMb: null }))).toBeNull();
    expect(reportedMemoryMb("not json")).toBeNull();
    expect(reportedMemoryMb(null)).toBeNull();
  });
});

describe("build CPU range", () => {
  it("defaults to two cores and caps the saved setting to a smaller reported Nest server", () => {
    expect(DEFAULT_BUILD_CPUS).toBe(2);
    expect(buildCpuRange(8)).toEqual({ min: 0.5, max: 8, default: 2 });
    expect(buildCpuRange(1)).toEqual({ min: 0.5, max: 1, default: 1 });
  });

  it("keeps the current two-core cap when the probe is missing", () => {
    expect(buildCpuRange(null)).toEqual({ min: 0.5, max: 2, default: 2 });
    expect(buildCpuRange(0)).toEqual({ min: 0.5, max: 2, default: 2 });
  });

  it("accepts quarter-core increments only within the reported capacity", () => {
    expect(checkBuildCpu(1.25, 4)).toBeNull();
    expect(checkBuildCpu(1.1, 4)).toMatch(/0.25/);
    expect(checkBuildCpu(0.25, 4)).toMatch(/0.5/);
    expect(checkBuildCpu(4.25, 4)).toMatch(/4/);
  });
});

describe("reported CPU capability", () => {
  it("reads a positive core count from the server probe", () => {
    expect(reportedCpus(JSON.stringify({ cpus: 8 }))).toBe(8);
    expect(reportedCpus(JSON.stringify({ cpus: 0 }))).toBeNull();
    expect(reportedCpus("not json")).toBeNull();
  });
});

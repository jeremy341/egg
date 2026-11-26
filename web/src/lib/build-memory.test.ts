import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUILD_MEMORY_MB,
  buildMemoryRange,
  checkBuildMemory,
  reportedMemoryMb,
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

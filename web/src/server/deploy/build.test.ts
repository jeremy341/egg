import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { MAX_LOG_LINE_CHARS, runProcess } from "@/server/deploy/build";

const dir = mkdtempSync(path.join(tmpdir(), "egg-build-proc-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const MARKER = "… [truncated]";
const run = (script: string, opts: Parameters<typeof runProcess>[2] = {}) =>
  runProcess(process.execPath, ["-e", script], opts);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runProcess output bounds", () => {
  it("caps a single enormous line instead of accumulating it without limit", async () => {
    const lines: string[] = [];
    const code = await run("process.stdout.write('a'.repeat(2 * 1024 * 1024))", {
      onLine: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0].length).toBeLessThanOrEqual(MAX_LOG_LINE_CHARS + MARKER.length);
    expect(lines[0].endsWith(MARKER)).toBe(true);
  });

  it("still emits short lines that follow a truncated one", async () => {
    const lines: string[] = [];
    const code = await run("process.stdout.write('a'.repeat(2 * 1024 * 1024) + '\\ntail\\n')", {
      onLine: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines[0].endsWith(MARKER)).toBe(true);
    expect(lines[1]).toBe("tail");
  });

  it("keeps multi-byte characters intact across pipe chunks", async () => {
    const lines: string[] = [];
    const code = await run("process.stdout.write('€'.repeat(3000))", { onLine: (l) => lines.push(l) });
    expect(code).toBe(0);
    expect(lines.join("")).toBe("€".repeat(3000));
  });
});

describe("runProcess cancellation and timeouts", () => {
  it("rejects an already-aborted signal without starting the child", async () => {
    const marker = path.join(dir, "should-not-exist");
    const controller = new AbortController();
    controller.abort();
    await expect(run(
      `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`,
      { signal: controller.signal }
    )).rejects.toThrow(/canceled/i);
    await wait(150);
    expect(existsSync(marker)).toBe(false);
  });

  it("removes the abort listener once the child closes", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    expect(await run("", { signal: controller.signal })).toBe(0);
    expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
  });

  it("removes the abort listener when the child fails to start", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await expect(runProcess("this-command-does-not-exist-egg-test", [], { signal: controller.signal }))
      .rejects.toThrow(/could not start/i);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("kills and rejects a process that exceeds its timeout", async () => {
    await expect(run("setInterval(() => {}, 1000)", { timeoutMs: 50 }))
      .rejects.toThrow(/timed out/i);
  });
});

describe("git command wiring", () => {
  const source = readFileSync(path.join(__dirname, "build.ts"), "utf8");

  it("passes the combined watchdog signal to readHead", () => {
    const block = source.slice(source.indexOf("readHead: async () => {"), source.indexOf("fetch: () => runProcess"));
    expect(block).toContain("signal,");
    expect(block).not.toContain("req.signal");
  });

  it("bounds the git log call with a timeout", () => {
    const block = source.slice(source.indexOf('runProcess("git", ["log"'), source.indexOf("if (commitCode"));
    expect(block).toContain("timeoutMs:");
  });
});

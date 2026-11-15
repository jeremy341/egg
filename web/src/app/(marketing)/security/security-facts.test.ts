import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_FACTS } from "@/components/marketing/home-facts";
import { DEFAULT_MAX_BODY_BYTES } from "@/server/api-v1-kit";
import { UPLOAD_LIMIT, FILE_READ_LIMIT } from "@/server/files";
import { RATE_LIMITS } from "@/server/rate-limit";
import { TERMINAL_LIMITS } from "@/server/terminal";
import { SECURITY_FACTS as F } from "./_components/facts";

const src = (file: string) => readFileSync(path.resolve(__dirname, "../../../..", file), "utf8");

describe("security page numbers match the code", () => {
  it("states the rate limits", () => {
    expect(F.signInPerMinute).toBe(RATE_LIMITS.signIn.limit);
    expect(F.badTokenPerMinute).toBe(RATE_LIMITS.badToken.limit);
    expect(F.terminalInputPerMinute).toBe(RATE_LIMITS.terminalInput.limit);
    expect(F.fileChangesPerMinute).toBe(RATE_LIMITS.fileWrite.limit);
    expect(F.leftoverRemovalsPerMinute).toBe(RATE_LIMITS.orphanRemoval.limit);
    expect(F.fileReadsPerMinute).toBe(FILE_READ_LIMIT.limit);
    for (const r of [RATE_LIMITS.signIn, RATE_LIMITS.badToken, RATE_LIMITS.terminalInput, RATE_LIMITS.fileWrite]) {
      expect(r.windowMs).toBe(60_000);
    }
    expect(FILE_READ_LIMIT.windowMs).toBe(60_000);
    expect(F.terminalsPerAccount).toBe(TERMINAL_LIMITS.maxSessionsPerUser);
  });

  it("states the size limits", () => {
    expect(F.apiBodyKb * 1024).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(F.uploadMb * 1024 * 1024).toBe(UPLOAD_LIMIT);
    expect(src("src/app/api/hooks/deploy/[token]/route.ts")).toContain(`MAX_BODY_BYTES = ${F.deployHookBodyKb} * 1024;`);
    expect(src("src/app/api/mcp/route.ts")).toContain(`MAX_BODY_BYTES = ${F.mcpBodyKb} * 1024;`);
    expect(src("src/app/api/webhooks/github/route.ts")).toContain(`MAX_BODY_BYTES = ${F.githubBodyMb} * 1024 * 1024;`);
  });

  it("states how long a GitHub delivery is remembered and how many build log lines are kept", () => {
    expect(F.deliveryHours).toBe(1);
    expect(src("src/server/github/webhook.ts")).toContain("DELIVERY_TTL_MS = 60 * 60_000;");
    expect(src("src/server/deploy/logger.ts")).toContain("MAX_LOG_ROWS = 20_000;");
    expect(F.buildLogLines).toBe(20_000);
  });

  it("states the build sandbox", () => {
    const build = src("src/server/deploy/build.ts");
    const flag = (name: string, value: string | number) => new RegExp(`"${name}",\\s+"${value}",`);
    expect(build).toMatch(flag("--cpus", F.buildCpus));
    expect(build).toMatch(flag("--pids-limit", F.buildProcesses));
    expect(build).toMatch(/"--cap-drop",\s+"ALL",/);
    expect(build).toContain("no-new-privileges");
    expect(build).toMatch(flag("--memory", `${HOME_FACTS.buildMemoryGb}g`));
  });

  it("sends the headers the page lists", () => {
    const cfg = src("next.config.ts");
    for (const h of [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "strict-origin-when-cross-origin",
      "camera=(), microphone=(), geolocation=(), payment=()",
      "max-age=63072000",
    ]) {
      expect(cfg).toContain(h);
    }
  });
});

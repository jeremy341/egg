import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPIRY_OPTIONS, TOKEN_CANNOT } from "@/lib/developer";
import { PAGEVIEW_KEEP_MS, snippet } from "@/server/analytics";
import { NO_FEATURES, featuresPatch } from "@/server/analytics-config";
import { BUILD_STEP_FLOOR_MB, DEFAULT_CONTAINER_BUILD_MEMORY_MB } from "@/lib/build-memory";
import { SCOPES, SHORT_LIVED_MAX_DAYS } from "@/server/api-tokens";
import { REAUTH_WINDOW_MS } from "@/server/auth/session";
import { KEEP_RELEASES } from "@/server/deploy/layout";
import { FAILURES_BEFORE_DOWN } from "@/server/monitor";
import { resolveStartCommand } from "@/server/deploy/runtime";
import { TOOLS } from "@/server/mcp";
import { PREVIEW_PORT_MIN } from "@/server/projects";
import { TERMINAL_LIMITS } from "@/server/terminal";
import {
  DEPLOY_BOT_SCOPES,
  HOME_FACTS,
  MCP_TOOLS_SHOWN,
  TOKEN_SCOPES,
  analyticsSnippet,
} from "./home-facts";

const src = (file: string) => readFileSync(path.resolve(__dirname, "../../..", file), "utf8");
const MINUTE = 60_000;
const DAY = 86_400_000;

describe("homepage facts match the code", () => {
  it("keeps the number of releases and the preview ports", () => {
    expect(HOME_FACTS.releasesKept).toBe(KEEP_RELEASES);
    expect(HOME_FACTS.previewPortMin).toBe(PREVIEW_PORT_MIN);
  });

  it("states the terminal and sign-in limits", () => {
    expect(HOME_FACTS.reauthMinutes * MINUTE).toBe(REAUTH_WINDOW_MS);
    expect(HOME_FACTS.terminalIdleMinutes * MINUTE).toBe(TERMINAL_LIMITS.idleMs);
    expect(HOME_FACTS.terminalMaxMinutes * MINUTE).toBe(TERMINAL_LIMITS.maxAgeMs);
  });

  it("states how long data is kept and how far the status page looks back", () => {
    expect(HOME_FACTS.pageviewDays * DAY).toBe(PAGEVIEW_KEEP_MS);
    // A project chooses 30, 60 or 90 days and keeps 90 until it does.
    expect(HOME_FACTS.pageviewDays).toBe(NO_FEATURES.retentionDays);
    for (const days of HOME_FACTS.pageviewDayChoices) expect(featuresPatch.safeParse({ retentionDays: days }).success).toBe(true);
    expect(featuresPatch.safeParse({ retentionDays: 45 }).success).toBe(false);
    expect(HOME_FACTS.pageviewDayChoices).toContain(HOME_FACTS.pageviewDays);
    expect(src("src/server/status-page.ts")).toContain(`const windowDays = ${HOME_FACTS.statusWindowDays};`);
  });

  it("lists every token scope and the expiry choices", () => {
    expect([...TOKEN_SCOPES]).toEqual([...SCOPES]);
    for (const s of DEPLOY_BOT_SCOPES) expect(TOKEN_SCOPES).toContain(s);
    expect(HOME_FACTS.shortLivedDays).toBe(SHORT_LIVED_MAX_DAYS);
    expect(EXPIRY_OPTIONS.map((o) => o.days)).toEqual([7, 30, 90, 365]);
    expect(TOKEN_CANNOT.length).toBeGreaterThan(0);
  });

  it("names MCP tools that exist", () => {
    const names = TOOLS.map((t) => t.name);
    for (const tool of MCP_TOOLS_SHOWN) expect(names).toContain(tool);
  });

  it("shows the page view snippet in the shape the app gives out", () => {
    expect(snippet("nda_KEY")).toBe(analyticsSnippet("http://localhost:3000", "nda_KEY"));
  });

  it("shows the default start commands", () => {
    expect(resolveStartCommand({ runtime: "node", startCommand: null }, null, 3000)).toBe("npm start");
    expect(resolveStartCommand({ runtime: "python", startCommand: null }, null, 3000)).toBe("python3 app.py");
    expect(resolveStartCommand({ runtime: "static", startCommand: null }, null, 3000)).toMatch(/^python3 -c /);
  });

  it("states the uptime check interval and the failed checks before an alert", () => {
    expect(src("src/server/jobs.ts")).toContain(
      `process.env.MONITOR_INTERVAL_MS, ${HOME_FACTS.checkIntervalMinutes} * 60_000`
    );
    expect(HOME_FACTS.failedChecksBeforeAlert).toBe(FAILURES_BEFORE_DOWN);
    expect(src("src/server/db/schema.ts")).toContain(
      `integer("alert_failures").notNull().default(${HOME_FACTS.failedChecksBeforeAlert})`
    );
  });

  it("states the health wait and the build memory limit", () => {
    expect(src("src/server/deploy/pipeline.ts")).toContain(`healthTimeoutSeconds: ${HOME_FACTS.healthWaitSeconds},`);
    expect(DEFAULT_CONTAINER_BUILD_MEMORY_MB).toBe(HOME_FACTS.buildMemoryMb);
    expect(BUILD_STEP_FLOOR_MB).toBe(HOME_FACTS.buildStepFloorMb);
    expect(src("src/server/deploy/container-build.ts")).toContain("--property=MemoryMax=");
  });

  it("uses the new project form's default port in the sample logs", () => {
    expect(src("src/components/new-project-flow.tsx")).toContain(`useState("${HOME_FACTS.defaultPort}")`);
  });

  it("labels each server key the way the homepage shows it", () => {
    expect(src("src/server/servers.ts")).toContain("generateServerKey(`egg:");
  });
});

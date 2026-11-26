import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGEVIEW_KEEP_MS, RETENTION_PERIOD_MS } from "@/server/analytics";
import { NO_FEATURES, featuresPatch } from "@/server/analytics-config";
import { UTM_ALLOWLIST_MAX, UTM_ALLOWLIST_VALUE, allowlistedUtm, cleanReferrer } from "@/server/analytics-fields";
import { optedOut } from "@/server/analytics-events";
import { DEFAULT_MAX_BODY_BYTES } from "@/server/api-v1-kit";
import { JSON_BODY_LIMIT } from "@/server/body-limit";
import { trustProxyEnabled } from "@/server/config";
import { isUniqueViolation } from "@/server/db/errors";
import { maskSecrets, secretNeedles } from "@/server/deploy/redact";
import { checkDomainPolicy } from "@/server/domain-policy";
import {
  BUILD_CPU_STEP,
  BUILD_STEP_FLOOR_MB,
  CONTAINER_RESERVE_MB,
  DEFAULT_BUILD_CPUS,
  DEFAULT_CONTAINER_BUILD_MEMORY_MB,
  MIN_BUILD_CPUS,
} from "@/lib/build-memory";
import { BUILD_TIMEOUT_SECONDS, MIN_CONTAINER_CAP_MB, systemdRunArgs } from "@/server/deploy/container-build";
import { MIN_FREE_DISK_MB } from "@/server/deploy/container-probe";
import { LOGIN_ERRORS } from "@/lib/login-errors";
import { UPLOAD_LIMIT, FILE_READ_LIMIT } from "@/server/files";
import { RATE_LIMITS, pickClientIp } from "@/server/rate-limit";
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

  it("states the dashboard body cap", () => {
    expect(F.dashboardBodyKb * 1024).toBe(JSON_BODY_LIMIT);
    // The 413 the page promises, and the shared reader the signed-in routes use.
    expect(src("src/server/body-limit.ts")).toContain('new HttpError(413, "That request is too large."');
    expect(src("src/server/http.ts")).toContain("readJsonLimited(req)");
  });

  it("states the analytics privacy rules", () => {
    // Campaign values are recorded only from the allowlist, matched exactly.
    expect(NO_FEATURES.campaigns).toBe(false);
    expect(F.utmAllowlistMax).toBe(UTM_ALLOWLIST_MAX);
    expect(UTM_ALLOWLIST_VALUE.test("a".repeat(F.utmValueChars))).toBe(true);
    expect(UTM_ALLOWLIST_VALUE.test("a".repeat(F.utmValueChars + 1))).toBe(false);
    const allow = { source: ["news"], medium: [], campaign: [] };
    expect(allowlistedUtm({ source: "news", medium: "email", campaign: "x" }, allow)).toEqual({ source: "news", medium: null, campaign: null });
    expect(allowlistedUtm({ source: "News" }, allow).source).toBeNull();
    // A project keeps page views for 30, 60 or 90 days, and 90 until it chooses.
    for (const days of F.analyticsKeepDays) expect(featuresPatch.safeParse({ retentionDays: days }).success).toBe(true);
    expect(featuresPatch.safeParse({ retentionDays: 45 }).success).toBe(false);
    expect(F.analyticsKeepDefaultDays).toBe(NO_FEATURES.retentionDays);
    expect(F.analyticsKeepDefaultDays * 86_400_000).toBe(PAGEVIEW_KEEP_MS);
    // Countries are off by default, looked up offline in the request, and only the code is stored.
    expect(NO_FEATURES.locations).toBe(false);
    expect(src("src/server/analytics.ts")).toContain("country: await countryToStore(f.locations, who.ip),");
    expect(src("src/server/analytics-locations.ts")).toContain('import("geoip-country")');
    // Turning these switches off deletes what they stored.
    const config = src("src/server/analytics-config.ts");
    for (const cleared of ["set({ vid: null })", "set({ country: null })", "set({ referrer: null })", "set({ utmSource: null, utmMedium: null, utmCampaign: null })"]) {
      expect(config).toContain(cleared);
    }
    expect(F.retentionRotationDays * 86_400_000).toBe(RETENTION_PERIOD_MS);
    // Referrers keep the host and nothing else.
    expect(cleanReferrer("https://news.example.com/a/b?token=1#x")).toBe("news.example.com");
    // Do Not Track and Global Privacy Control are both honoured by the collector.
    expect(optedOut(new Headers({ dnt: "1" }))).toBe(true);
    expect(optedOut(new Headers({ "sec-gpc": "1" }))).toBe(true);
    expect(optedOut(new Headers())).toBe(false);
    // No cookie, and the page-view table has no address column to hold one.
    const script = src("src/server/analytics-script.ts");
    expect(script).toContain("n.globalPrivacyControl === true");
    expect(script).not.toMatch(/document\.cookie\s*=/);
    expect(src("src/server/db/schema.ts")).not.toMatch(/ip: text\(/);
  });

  it("keeps the address setting off by default and ignores forwarded headers", () => {
    expect(trustProxyEnabled({})).toBe(false);
    expect(trustProxyEnabled({ TRUST_PROXY: "0" })).toBe(false);
    expect(trustProxyEnabled({ TRUST_PROXY: "1" })).toBe(true);
    expect(src(".env.example")).toMatch(/^TRUST_PROXY=0/m);
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(pickClientIp(h, false)).toBeNull();
    expect(pickClientIp(h, true)).toBe("5.6.7.8");
  });

  it("masks encoded and short secrets, and leaves one-character values alone", () => {
    const hidden = (value: string, text: string) => maskSecrets(text, secretNeedles([value]));
    expect(hidden("hunter22secret", `x ${Buffer.from("hunter22secret").toString("base64")} y`)).toBe("x *** y");
    expect(hidden("p@ss word!", `x ${encodeURIComponent("p@ss word!")} y`)).toBe("x *** y");
    expect(hidden("abc", "token abc end")).toBe("token *** end");
    expect(hidden("abc", "abcdef")).toBe("abcdef");
    expect(hidden("1", "CI=1")).toBe("CI=1");
  });

  it("asks for the host key before anything else runs", () => {
    const servers = src("src/server/servers.ts");
    expect(servers).toContain('"host_key_unconfirmed"');
    expect(servers).toContain("if (!pinned && !opts.confirmHostKey)");
    expect(src("src/app/api/servers/[id]/test/route.ts")).toContain("confirmHostKey");
  });

  it("stops two identical active deploys with unique indexes", () => {
    const sql = src("drizzle/0013_security_prefs.sql");
    for (const name of ["deployments_active_webhook_commit_idx", "deployments_active_hook_idx", "jobs_active_deployment_idx"]) {
      expect(sql).toContain(`CREATE UNIQUE INDEX \`${name}\``);
    }
    expect(isUniqueViolation(new Error("UNIQUE constraint failed: deployments.project_id"))).toBe(true);
    expect(isUniqueViolation(new Error("something else"))).toBe(false);
    expect(src("src/server/hooks.ts")).toContain('"busy"');
  });

  it("has a message for a rate-limited sign-in", () => {
    expect(LOGIN_ERRORS.rate_limited).toMatch(/wait a minute/i);
    expect(src("src/server/auth/throttle.ts")).toContain('"rate_limited"');
  });

  it("has a dependency audit script, and a CI workflow that runs it", () => {
    const pkg = JSON.parse(src("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["audit:prod"]).toBe("pnpm audit --prod --audit-level high");
    expect(existsSync(path.resolve(__dirname, "../../../../../.github/workflows/ci.yml"))).toBe(true);
    expect(readFileSync(path.resolve(__dirname, "../../../../../.github/workflows/ci.yml"), "utf8")).toContain("audit:prod");
  });

  it("applies the domain rules the page lists", () => {
    expect(checkDomainPolicy("admin", "sam")).toMatchObject({ allowed: false, code: "reserved" });
    expect(checkDomainPolicy("admin.hackclub.app", "sam")).toMatchObject({ allowed: false, code: "reserved" });
    expect(checkDomainPolicy("other.hackclub.app", "sam")).toMatchObject({ allowed: false, code: "nest-name" });
    expect(checkDomainPolicy("sam.hackclub.app", "sam")).toEqual({ allowed: true });
    expect(checkDomainPolicy("192.168.0.1", "sam")).toMatchObject({ allowed: false, code: "not-public" });
    expect(checkDomainPolicy("app.example.com", "sam")).toEqual({ allowed: true });
    expect(src("src/server/domains.ts")).toContain('status: verifiedBy === "dns" ? "pending" : "valid"');
  });

  it("keeps the gaps list honest about what is still open", () => {
    // The content policy still allows inline scripts, and the reason is still true.
    const cfg = src("next.config.ts");
    expect(cfg).toContain("cacheComponents: true");
    expect(cfg).toContain("script-src 'self' 'unsafe-inline'");
    // The analytics collector enforces its body cap as bytes arrive.
    const collect = src("src/app/api/collect/[key]/route.ts");
    expect(collect).toContain("await readTextLimited(req, COLLECT_BODY_LIMIT_BYTES)");
    expect(collect).not.toContain("await req.text()");
    // A build still runs as the Nest user, so the cap limits memory and CPU, not what the build can reach.
    const run = systemdRunArgs({ scope: "egg-build-0123abcd", memoryMb: 1024, cpuPercent: 200 }).join(" ");
    expect(run).not.toMatch(/--uid|--gid|User=|--user|PrivateTmp|ProtectHome|ReadOnlyPaths/);
  });

  it("states GitHub replay retention and how many build log lines are kept", () => {
    expect(F.deliveryDigestRetention).toBe("indefinitely");
    expect(src("src/server/github/webhook.ts")).toContain("schema.githubWebhookEvents");
    expect(src("src/server/github/webhook.ts")).toContain("Only the one-way digest is retained");
    const page = src("src/app/(marketing)/security/page.tsx");
    expect(page).not.toMatch(/delivery list are kept in\s+memory/i);
    expect(page).toContain("GitHub signs the body, but not the");
    expect(page).toContain("Because the event header is unsigned");
    expect(src("src/server/deploy/logger.ts")).toContain("MAX_LOG_ROWS = 20_000;");
    expect(F.buildLogLines).toBe(20_000);
  });

  it("caps the public analytics collector body while reading it", () => {
    expect(F.analyticsCollectBodyBytes).toBe(5000);
    expect(src("src/app/api/collect/[key]/route.ts")).toMatch(/COLLECT_BODY_LIMIT_BYTES\s*=\s*5_000/);
  });

  it("states the cap on a build on the container", () => {
    expect(F.buildMemoryMb).toBe(DEFAULT_CONTAINER_BUILD_MEMORY_MB);
    expect(F.buildStepFloorMb).toBe(BUILD_STEP_FLOOR_MB);
    expect(F.buildReserveMb).toBe(CONTAINER_RESERVE_MB);
    expect(F.buildMinCapMb).toBe(MIN_CONTAINER_CAP_MB);
    expect(F.buildMinFreeDiskMb).toBe(MIN_FREE_DISK_MB);
    expect(F.buildMinutes * 60).toBe(BUILD_TIMEOUT_SECONDS);
    expect(F.buildCpuDefault).toBe(DEFAULT_BUILD_CPUS);
    expect(F.buildCpuMin).toBe(MIN_BUILD_CPUS);
    expect(F.buildCpuStep).toBe(BUILD_CPU_STEP);
    // The properties the page promises: a memory cap with no swap, a CPU quota, a low priority and a process cap.
    const args = systemdRunArgs({ scope: "egg-build-0123abcd", memoryMb: 1024, cpuPercent: 200 });
    expect(args).toContain("--property=MemoryMax=1024M");
    expect(args).toContain("--property=MemorySwapMax=0");
    expect(args).toContain("--property=CPUQuota=200%");
    expect(args.some((a) => a.startsWith("--property=CPUWeight="))).toBe(true);
    expect(args).toContain(`--property=TasksMax=${F.buildProcesses}`);
    // The page says nothing is built on Egg's server, and the GitHub token has no place in the container build.
    const page = src("src/app/(marketing)/security/page.tsx").replace(/\s+/g, " ");
    expect(page).toContain("Nothing is installed or built on Egg&apos;s server.");
    expect(page).not.toMatch(/sandbox|Docker|BUILD_RUNNER/i);
    expect(src("src/server/deploy/container-build.ts")).not.toMatch(/token/i);
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

  it("describes disconnecting as the owner's choice, not as deleting every project", () => {
    const page = src("src/app/(marketing)/security/page.tsx").replace(/\s+/g, " ");
    expect(page).not.toContain("with it every project on that server");
    expect(page).toContain("Whether the projects on that server go too is your choice");
    expect(page).toContain("Also delete the projects on this server");
    // The code the sentence describes: the choice defaults to keeping the projects.
    expect(src("src/server/servers.ts")).toContain("deleteProjects: z.boolean().default(false)");
  });
});

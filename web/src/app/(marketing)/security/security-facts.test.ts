import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGEVIEW_KEEP_MS, RETENTION_PERIOD_MS } from "@/server/analytics";
import { UTM_MAX, cleanReferrer } from "@/server/analytics-fields";
import { optedOut } from "@/server/analytics-events";
import { DEFAULT_MAX_BODY_BYTES } from "@/server/api-v1-kit";
import { JSON_BODY_LIMIT } from "@/server/body-limit";
import { trustProxyEnabled } from "@/server/config";
import { isUniqueViolation } from "@/server/db/errors";
import { maskSecrets, secretNeedles } from "@/server/deploy/redact";
import { checkDomainPolicy } from "@/server/domain-policy";
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
    expect(F.utmChars).toBe(UTM_MAX);
    expect(F.analyticsKeepDays * 86_400_000).toBe(PAGEVIEW_KEEP_MS);
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

  it("has a dependency audit script, and no CI workflow runs it yet", () => {
    const pkg = JSON.parse(src("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["audit:prod"]).toBe("pnpm audit --prod --audit-level high");
    // When a workflow is added, say so on the page and change this line.
    expect(existsSync(path.resolve(__dirname, "../../../../../.github/workflows"))).toBe(false);
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
    // The public page-view endpoint still reads its body without a cap.
    const collect = src("src/app/api/collect/[key]/route.ts");
    expect(collect).toContain("await req.text()");
    expect(collect).not.toContain("readTextLimited");
    // A local build is still unsandboxed, and Windows builds still do not set --user.
    expect(src(".env.example")).toContain("local = no isolation");
    expect(src("src/server/deploy/build.ts")).toContain('process.platform !== "win32"');
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
    expect(build).toContain('"--memory",');
    expect(build).toContain("`${memoryMb}m`");
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
